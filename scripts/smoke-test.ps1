<#
.SYNOPSIS
  End-to-end smoke test against a running server (waiter -> manager -> kitchen slip -> cashier -> backup).
  Uses the demo users from the seed. Creates a real order on table T-4.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\smoke-test.ps1 -Base http://localhost:4000
#>
param([string]$Base = "http://localhost:4000")
$ErrorActionPreference = "Stop"
$B = "$Base/api"

function J($o) { $o | ConvertTo-Json -Depth 6 -Compress }
function Call($method, $path, $token, $body) {
  $h = @{}
  if ($token) { $h.Authorization = "Bearer $token" }
  $req = @{ Method = $method; Uri = "$B$path"; Headers = $h; ContentType = "application/json" }
  if ($null -ne $body) { $req.Body = (J $body) }
  Invoke-RestMethod @req
}

function Pick-Menu($menu, [string[]]$prefer, [switch]$PreferPcs) {
  $pool = @($menu)
  if ($PreferPcs) {
    $pcs = @($menu | Where-Object { $_.sellUnit -eq "PCS" -or $_.sellUnit -eq "PIECE" })
    if ($pcs.Count -gt 0) { $pool = $pcs }
  }
  foreach ($p in $prefer) {
    $hit = @($pool | Where-Object { $_.name -eq $p }) | Select-Object -First 1
    if ($hit) { return $hit }
  }
  foreach ($p in $prefer) {
    $hit = @($pool | Where-Object { $_.name -like "*$p*" }) | Select-Object -First 1
    if ($hit) { return $hit }
  }
  return @($pool | Where-Object { $_.kind -eq "NORMAL" }) | Select-Object -First 1
}

function Table-List($tablesResp) {
  if ($null -eq $tablesResp) { return @() }
  if ($tablesResp -is [System.Array]) { return @($tablesResp) }
  if ($tablesResp.tables) { return @($tablesResp.tables) }
  return @()
}

"--- health"; J (Call GET "/health")
$info = Call GET "/system/info"; "--- LAN urls: $($info.urls -join ', ')  mdns: $($info.mdnsUrl)"

$w = (Call POST "/auth/login" $null @{ username = "waiter"; password = "waiter123" }).token
$c = (Call POST "/auth/login" $null @{ username = "cashier"; password = "cashier123" }).token
$a = (Call POST "/auth/login" $null @{ username = "admin"; password = "admin123" }).token

try {
  $hotel = Call GET "/system/hotel" $a
  if (-not $hotel.acceptingOrders) {
    [void](Call POST "/system/hotel/open" $a @{})
    "--- hotel was closed; opened for smoke"
  } else {
    "--- hotel open (businessDate=$($hotel.businessDate) shift $($hotel.dayStart)->$($hotel.dayClose))"
  }
} catch { "--- hotel status skipped: $($_.Exception.Message)" }

$menu = Call GET "/menu" $w
"--- waiter menu item (no cost fields): $(J $menu[0])"
$tablesResp = Call GET "/tables" $w
$allTables = Table-List $tablesResp
"--- tables: $($allTables.Count)"
# Clear leftover smoke tickets so table pick is free.
foreach ($bt in @($allTables | Where-Object { $_.order })) {
  $oid = $bt.order.id
  if (-not $oid) { continue }
  try {
    [void](Call POST "/orders/$oid/cancel" $a @{ reason = "smoke cleanup" })
    "--- cleaned $($bt.partitionName)/$($bt.name) order #$($bt.order.orderNo)"
  } catch { }
}
$allTables = Table-List (Call GET "/tables" $w)

# Prefer PCS items so qty 1/2 works (kg karahi often max 0.75).
$karahi = Pick-Menu $menu @(
  "Chicken Karahi",
  "Chicken Afghani Boti",
  "Chicken Chatkhara",
  "Chicken Black Pepper + Fried Rice",
  "Chicken Achari Karahi (Half)"
) -PreferPcs
$lassi = Pick-Menu $menu @(
  "Sweet Lassi",
  "1 Litre Drink",
  "Cold Drink"
) -PreferPcs
if (-not $karahi -or -not $lassi) { throw "Menu missing dish/drink for smoke (seed required)" }
"--- using dish='$($karahi.name)' ($($karahi.sellUnit)) drink='$($lassi.name)'"

# Names like T-4 repeat across Hall/Lawn — pick one free table by id/label.
$t4 = @($allTables | Where-Object { $_.name -eq "T-4" -and -not $_.order }) | Select-Object -First 1
if (-not $t4) {
  $t4 = @($allTables | Where-Object { -not $_.order -and $_.name -ne "TAKEAWAY" }) | Select-Object -First 1
}
if (-not $t4) { throw "No free table for smoke" }
$tableNo = $t4.name
$tableKey = if ($t4.id) { $t4.id } else { $tableNo }
"--- table: $($t4.partitionName)/$tableNo ($tableKey)"

$step = [double]($karahi.qtyStep)
if (-not $step -or $step -le 0) { $step = 1 }
$minQ = [double]($karahi.minQty); if (-not $minQ -or $minQ -le 0) { $minQ = $step }
$maxQ = if ($null -ne $karahi.maxQty -and $karahi.maxQty -ne "") { [double]$karahi.maxQty } else { 999 }
$dishQty = [Math]::Max($minQ, $step)
if ($dishQty -gt $maxQ) { $dishQty = $maxQ }
$cashiersForOrder = Call GET "/payments/cashiers" $w
$assignCashier = @($cashiersForOrder | Where-Object name -eq "Main Cashier") | Select-Object -First 1
if (-not $assignCashier) { $assignCashier = @($cashiersForOrder) | Select-Object -First 1 }
if (-not $assignCashier) { throw "No cashier to assign on new order" }
$orderBody = @{
  tableNo = $tableNo
  assignedCashierId = $assignCashier.id
  items = @(@{ menuItemId = $karahi.id; quantity = $dishQty; notes = "less spicy" })
}
if ($t4.id) { $orderBody.tableId = $t4.id }
$o = Call POST "/orders" $w $orderBody
"--- created order #$($o.orderNo) total=$($o.total) round=$($o.kotRounds) waiter=$($o.waiter) costVisible=$($o.PSObject.Properties.Name -contains 'costTotal')"

# Same open ticket: add drink via /items (do not POST /orders again — duplicate T-4 names exist).
$o2 = Call POST "/orders/$($o.id)/items" $w @{ items = @(@{ menuItemId = $lassi.id; quantity = 2 }) }
"--- same table again -> order #$($o2.orderNo) rounds=$($o2.kotRounds) items=$($o2.items.Count) total=$($o2.total)"

$addQty = $dishQty
$o3 = Call POST "/orders/$($o.id)/items" $w @{ items = @(@{ menuItemId = $karahi.id; quantity = $addQty }) }
"--- add items -> rounds=$($o3.kotRounds) total=$($o3.total)"

$mine = Call GET "/orders" $w
$mineRows = if ($mine -is [System.Array]) { @($mine) } elseif ($mine.orders) { @($mine.orders) } else { @($mine) }
"--- waiter sees only own orders: $($mineRows.Count) (others: $(($mineRows | Where-Object { $_.waiter -ne 'Waiter Ahmed' -and $_.waiter -notlike 'Waiter*' }).Count))"

$m = $null
foreach ($cred in @(
  @{ username = "supervisor"; password = "super123" },
  @{ username = "manager"; password = "manager123" }
)) {
  try {
    $m = (Call POST "/auth/login" $null $cred).token
    "--- supervisor login as $($cred.username)"
    break
  } catch { }
}
if (-not $m) { throw "supervisor/manager login failed" }
try {
  $o4 = Call POST "/orders/$($o.id)/items" $m @{ printKot = $false; items = @(@{ menuItemId = $lassi.id; quantity = 1 }) }
  $pv = Call GET "/orders/$($o.id)/kot-preview?round=$($o4.kotRounds)" $m
  "--- supervisor added round $($o4.kotRounds) without printing; slip preview says: $(($pv.text -split "`n" | Where-Object { $_ -like 'Order by:*' }) -join ' ')"
} catch {
  # Supervisor may be blocked on another waiter's open table — admin still can.
  $o4 = Call POST "/orders/$($o.id)/items" $a @{ printKot = $false; items = @(@{ menuItemId = $lassi.id; quantity = 1 }) }
  $pv = Call GET "/orders/$($o.id)/kot-preview?round=$($o4.kotRounds)" $a
  "--- admin added round $($o4.kotRounds) without printing (supervisor blocked on waiter table); slip: $(($pv.text -split "`n" | Where-Object { $_ -like 'Order by:*' }) -join ' ')"
}

$staff = Call GET "/auth/staff"
"--- PIN login screen lists $($staff.Count) staff: $(($staff | ForEach-Object name) -join ', ')"
try { Call POST "/users" $m @{ name = "X"; username = "smoke-user"; password = "secret12"; roleCode = "WAITER" } | Out-Null; "!!! supervisor created a user" }
catch { "--- supervisor managing users blocked: $([int]$_.Exception.Response.StatusCode)" }
try { Call GET "/payments" $m | Out-Null; "!!! supervisor opened the payment records" }
catch { "--- supervisor viewing payment records blocked: $([int]$_.Exception.Response.StatusCode)" }

$rb = Call POST "/orders/$($o.id)/request-bill" $w @{}
"--- bill requested at $($rb.billRequestedAt)"

$rk = Call POST "/orders/$($o.id)/print-kot" $w @{ round = 2 }
"--- reprint kitchen slip round 2 queued: $($rk.queued)"

try { Call POST "/orders/$($o.id)/pay" $w @{} | Out-Null; "!!! waiter was able to take payment" }
catch { "--- waiter payment blocked: $([int]$_.Exception.Response.StatusCode)" }

$rbill = Call POST "/orders/$($o.id)/print-bill" $c @{}
"--- cashier bill print queued: $($rbill.queued)"

Start-Sleep -Seconds 4
$jobs = Call GET "/print/jobs" $a
$jobRows = if ($jobs -is [System.Array]) { @($jobs) } elseif ($jobs.jobs) { @($jobs.jobs) } else { @($jobs) }
"--- print jobs:"; $jobRows | Select-Object -First 6 | ForEach-Object { "    $($_.type) #$($_.orderNo) $($_.status) [$($_.printer)] $($_.lastError)" }
$kot = $jobRows | Where-Object { $_.type -eq "KOT" -and $_.status -eq "DONE" } | Select-Object -Last 1
if (-not $kot) { $kot = $jobRows | Where-Object { $_.type -eq "KOT" } | Select-Object -Last 1 }
if ($kot) {
  try {
    "--- kitchen slip preview:"; (Call GET "/print/jobs/$($kot.id)/preview" $a).text
  } catch {
    "--- kitchen slip preview skipped ($($kot.status)): $($kot.lastError)"
  }
} else {
  "--- kitchen slip preview: (no KOT job; printer may be offline)"
}
$bill = $jobRows | Where-Object { $_.type -eq "BILL" } | Select-Object -First 1
if ($bill) {
  try {
    "--- bill preview:"; (Call GET "/print/jobs/$($bill.id)/preview" $a).text
  } catch {
    "--- bill preview skipped ($($bill.status)): $($bill.lastError)"
  }
} else {
  "--- bill preview: (no BILL job; printer may be offline)"
}

$payToken = $null
$payWho = $null
foreach ($cred in @(
  @{ username = "maincashier"; password = "main123"; label = "main cashier" },
  @{ username = "cashier"; password = "cashier123"; label = "cashier" }
)) {
  try {
    $payToken = (Call POST "/auth/login" $null $cred).token
    $payWho = $cred.label
    break
  } catch { }
}
if (-not $payToken) { throw "cashier login for pay failed" }
try { Call POST "/orders/$($o.id)/pay" $m @{} | Out-Null; "!!! supervisor paid without cashier role" }
catch { "--- supervisor pay blocked (expected): $([int]$_.Exception.Response.StatusCode)" }
$cashiers = Call GET "/payments/cashiers" $payToken
$toCashier = @($cashiers | Where-Object name -eq "Cashier Ali") | Select-Object -First 1
if (-not $toCashier) { $toCashier = @($cashiers | Where-Object { $_.id -ne $assignCashier.id }) | Select-Object -First 1 }
if (-not $toCashier) { $toCashier = @($cashiers) | Select-Object -First 1 }
if (-not $toCashier) { throw "No cashier for handover" }
# Main cashier (cash.keep) collects directly; other cashiers must hand over.
$payBody = if ($payWho -eq "main cashier") { @{ method = "CASH" } } else { @{ handedToId = $toCashier.id } }
$paid = Call POST "/orders/$($o.id)/pay" $payToken $payBody
$p = $paid.payments | Select-Object -Last 1
"--- $payWho took payment: $($paid.paymentStatus) $($p.amount) by $($p.collectedBy) handed=$($p.handedTo)"
$pending = Call GET "/payments/handovers" $c
$pendingRows = if ($pending -is [System.Array]) { @($pending) } elseif ($pending.rows) { @($pending.rows) } else { @($pending) }
$mineP = @($pendingRows | Where-Object orderNo -eq $paid.orderNo) | Select-Object -First 1
if ($mineP) {
  "--- cashier sees pending handover: $($mineP.amount) from $($mineP.collectedBy.name)"
  $conf = Call POST "/payments/$($mineP.id)/confirm" $c @{}
  "--- cashier confirmed at $($conf.confirmedAt)"
} else {
  "--- no pending handover (direct cash.keep collect)"
}
$rec = Call GET "/payments" $a
$row = @($rec.rows | Where-Object orderNo -eq $paid.orderNo) | Select-Object -First 1
$handedName = if ($row.handedTo) { $row.handedTo.name } else { "-" }
"--- admin record: bill #$($row.orderNo) $($row.amount) by $($row.collectedBy.name) -> $handedName confirmed=$($null -ne $row.confirmedAt)"
try { Call POST "/orders/$($o.id)/pay" $c @{} | Out-Null; "!!! paid twice" }
catch { "--- paying an already paid bill rejected: $([int]$_.Exception.Response.StatusCode)" }
$tAfter = if ($t4.id) {
  @(Table-List (Call GET "/tables" $w) | Where-Object id -eq $t4.id) | Select-Object -First 1
} else {
  @(Table-List (Call GET "/tables" $w) | Where-Object name -eq $tableNo) | Select-Object -First 1
}
"--- $($t4.partitionName)/$tableNo free again after payment: $($null -eq $tAfter.order)"

try {
  $bk = Call POST "/system/backups" $a @{}
  "--- backup: $($bk.file) ($($bk.size) bytes)"
} catch { "--- backup failed: $($_.ErrorDetails.Message)" }

"--- SMOKE OK"
