<#
.SYNOPSIS
  End-to-end smoke test against a running server (waiter -> manager -> kitchen slip -> cashier -> backup).
  Uses the demo users from the seed. Creates a real order on table T-4.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\smoke-test.ps1 -Base http://localhost:3000
#>
param([string]$Base = "http://localhost:3000")
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

"--- health"; J (Call GET "/health")
$info = Call GET "/system/info"; "--- LAN urls: $($info.urls -join ', ')  mdns: $($info.mdnsUrl)"

$w = (Call POST "/auth/login" $null @{ username = "waiter"; password = "waiter123" }).token
$c = (Call POST "/auth/login" $null @{ username = "cashier"; password = "cashier123" }).token
$a = (Call POST "/auth/login" $null @{ username = "admin"; password = "admin123" }).token

$menu = Call GET "/menu" $w
"--- waiter menu item (no cost fields): $(J $menu[0])"
$tables = Call GET "/tables" $w
"--- tables: $($tables.Count)"

$karahi = $menu | Where-Object name -eq "Chicken Karahi"
$lassi = $menu | Where-Object name -eq "Sweet Lassi"
$o = Call POST "/orders" $w @{ tableNo = "T-4"; items = @(@{ menuItemId = $karahi.id; quantity = 1.5; notes = "less spicy" }) }
"--- created order #$($o.orderNo) total=$($o.total) round=$($o.kotRounds) waiter=$($o.waiter) costVisible=$($o.PSObject.Properties.Name -contains 'costTotal')"

$o2 = Call POST "/orders" $w @{ tableNo = "T-4"; items = @(@{ menuItemId = $lassi.id; quantity = 2 }) }
"--- same table again -> order #$($o2.orderNo) rounds=$($o2.kotRounds) items=$($o2.items.Count) total=$($o2.total)"

$o3 = Call POST "/orders/$($o.id)/items" $w @{ items = @(@{ menuItemId = $karahi.id; quantity = 0.5 }) }
"--- add items -> rounds=$($o3.kotRounds) total=$($o3.total)"

$mine = Call GET "/orders" $w
"--- waiter sees only own orders: $($mine.Count) (others: $(($mine | Where-Object { $_.waiter -ne 'Waiter Ahmed' }).Count))"

$m = (Call POST "/auth/login" $null @{ username = "manager"; password = "manager123" }).token
$o4 = Call POST "/orders/$($o.id)/items" $m @{ printKot = $false; items = @(@{ menuItemId = $lassi.id; quantity = 1 }) }
$pv = Call GET "/orders/$($o.id)/kot-preview?round=$($o4.kotRounds)" $m
"--- manager added round $($o4.kotRounds) without printing; slip preview says: $(($pv.text -split "`n" | Where-Object { $_ -like 'Order by:*' }) -join ' ')"

$staff = Call GET "/auth/staff"
"--- PIN login screen lists $($staff.Count) staff: $(($staff | ForEach-Object name) -join ', ')"
try { Call POST "/users" $m @{ name = "X"; username = "smoke-user"; password = "secret12"; roleCode = "WAITER" } | Out-Null; "!!! manager created a user" }
catch { "--- manager managing users blocked: $([int]$_.Exception.Response.StatusCode)" }
try { Call GET "/payments" $m | Out-Null; "!!! manager opened the payment records" }
catch { "--- manager viewing payment records blocked: $([int]$_.Exception.Response.StatusCode)" }

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
"--- print jobs:"; $jobs | Select-Object -First 6 | ForEach-Object { "    $($_.type) #$($_.orderNo) $($_.status) [$($_.printer)] $($_.lastError)" }
$kot = $jobs | Where-Object { $_.type -eq "KOT" -and $_.status -eq "DONE" } | Select-Object -Last 1
"--- kitchen slip preview:"; (Call GET "/print/jobs/$($kot.id)/preview" $a).text
$bill = $jobs | Where-Object { $_.type -eq "BILL" } | Select-Object -First 1
"--- bill preview:"; (Call GET "/print/jobs/$($bill.id)/preview" $a).text

try { Call POST "/orders/$($o.id)/pay" $m @{} | Out-Null; "!!! manager paid without naming a cashier" }
catch { "--- manager pay without cashier rejected: $([int]$_.Exception.Response.StatusCode)" }
$cashiers = Call GET "/payments/cashiers" $m
$toCashier = $cashiers | Where-Object name -eq "Cashier Ali"
$paid = Call POST "/orders/$($o.id)/pay" $m @{ handedToId = $toCashier.id }
$p = $paid.payments | Select-Object -Last 1
"--- manager took payment: $($paid.paymentStatus) $($p.amount) received by $($p.collectedBy), handed to $($p.handedTo)"
$pending = Call GET "/payments/handovers" $c
$mineP = $pending | Where-Object orderNo -eq $paid.orderNo
"--- cashier sees pending handover: $($mineP.amount) from $($mineP.collectedBy.name)"
$conf = Call POST "/payments/$($mineP.id)/confirm" $c @{}
"--- cashier confirmed at $($conf.confirmedAt)"
$rec = Call GET "/payments" $a
$row = $rec.rows | Where-Object orderNo -eq $paid.orderNo
"--- admin record: bill #$($row.orderNo) $($row.amount) by $($row.collectedBy.name) -> $($row.handedTo.name) confirmed=$($null -ne $row.confirmedAt)"
try { Call POST "/orders/$($o.id)/pay" $c @{} | Out-Null; "!!! paid twice" }
catch { "--- paying an already paid bill rejected: $([int]$_.Exception.Response.StatusCode)" }
$t4 = (Call GET "/tables" $w) | Where-Object name -eq "T-4"
"--- T-4 free again after payment: $($null -eq $t4.order)"

try {
  $bk = Call POST "/system/backups" $a @{}
  "--- backup: $($bk.file) ($($bk.size) bytes)"
} catch { "--- backup failed: $($_.ErrorDetails.Message)" }
