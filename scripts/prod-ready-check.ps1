<#
.SYNOPSIS
  Production-ready regression checks (takeaway, dashboard, bills day window, kitchen filter, pay).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\prod-ready-check.ps1 -Base http://localhost:4000
#>
param([string]$Base = "http://localhost:4000")
$ErrorActionPreference = "Stop"
$B = "$Base/api"
$fail = 0
$pass = 0

function Ok([string]$msg) { $script:pass++; Write-Host "PASS  $msg" -ForegroundColor Green }
function Bad([string]$msg) { $script:fail++; Write-Host "FAIL  $msg" -ForegroundColor Red }
function Info([string]$msg) { Write-Host "----  $msg" -ForegroundColor Cyan }

function Call($method, $path, $token, $body) {
  $h = @{}
  if ($token) { $h.Authorization = "Bearer $token" }
  $req = @{ Method = $method; Uri = "$B$path"; Headers = $h; ContentType = "application/json" }
  if ($null -ne $body) { $req.Body = ($body | ConvertTo-Json -Depth 8 -Compress) }
  Invoke-RestMethod @req
}

function ExpectFail($method, $path, $token, $body, $label) {
  try {
    [void](Call $method $path $token $body)
    Bad "$label (expected error)"
  } catch {
    Ok "$label blocked as expected"
  }
}

Info "health"
$h = Call GET "/health"
if ($h.ok) { Ok "health ok version=$($h.version)" } else { Bad "health not ok" }

Info "login roles"
$admin = (Call POST "/auth/login" $null @{ username = "admin"; password = "admin123" }).token
$waiter = (Call POST "/auth/login" $null @{ username = "waiter"; password = "waiter123" }).token
$cashier = (Call POST "/auth/login" $null @{ username = "cashier"; password = "cashier123" }).token
$kitchen = $null
try {
  $kitchen = (Call POST "/auth/login" $null @{ username = "kitchen"; password = "kitchen123" }).token
  Ok "kitchen login"
} catch {
  try {
    $kitchen = (Call POST "/auth/login" $null @{ username = "cook"; password = "cook123" }).token
    Ok "cook login"
  } catch {
    Bad "no kitchen user login"
  }
}
$mainCash = $null
try {
  $mainCash = (Call POST "/auth/login" $null @{ username = "maincashier"; password = "maincashier123" }).token
  Ok "maincashier login"
} catch {
  try {
    $mainCash = (Call POST "/auth/login" $null @{ username = "main"; password = "main123" }).token
    Ok "main login"
  } catch {
    $mainCash = $cashier
    Info "using cashier as main cash token"
  }
}

$menu = Call GET "/menu" $waiter
$item = $menu | Where-Object { $_.active -ne $false } | Select-Object -First 1
if (-not $item) { $item = $menu | Select-Object -First 1 }
if (-not $item) { throw "No menu items" }
Ok "menu item $($item.name)"

Info "takeaway create"
$twName = "Smoke-TW-" + (Get-Random -Maximum 9999)
$tw = Call POST "/orders" $waiter @{
  tableNo = $twName
  items = @(@{ menuItemId = $item.id; quantity = 1 })
  printKot = $true
}
if ($tw.tableId) { Bad "takeaway has tableId=$($tw.tableId)" } else { Ok "takeaway has no tableId" }
if ($tw.status -ne "READY") { Bad "takeaway status=$($tw.status) expected READY" } else { Ok "takeaway status READY" }
if ($tw.kotRounds -gt 0) { Bad "takeaway kotRounds=$($tw.kotRounds)" } else { Ok "takeaway kotRounds=0" }
if (-not $tw.assignedCashierId -and -not $tw.assignedCashier) {
  Bad "takeaway not assigned to cashier"
} else {
  Ok "takeaway assigned cashier=$($tw.assignedCashier.name)"
}

$kitTok = if ($kitchen) { $kitchen } else { $admin }
$kitchenList = Call GET "/orders/kitchen" $kitTok
$onKitchen = @($kitchenList | Where-Object { $_.id -eq $tw.id })
if ($onKitchen.Count -gt 0) { Bad "takeaway still on kitchen board" } else { Ok "takeaway NOT on kitchen board" }

ExpectFail POST "/orders/$($tw.id)/print-kot" $waiter @{ reprint = $true } "takeaway print-kot"

Info "dashboard"
$dash = Call GET "/dashboard" $admin
Ok ("dashboard salesToday={0} revenueToday={1} ordersToday={2} unpaid={3}" -f $dash.salesToday, $dash.revenueToday, $dash.ordersToday, $dash.unpaidCount)

Info "table order kitchen path"
$board = Call GET "/tables" $waiter
$tableCards = @($board.tables)
$free = $tableCards | Where-Object { -not $_.order -and $_.id } | Select-Object -First 1
if (-not $free) {
  Info ("no free table - skipping table kitchen check (tables={0})" -f $tableCards.Count)
} else {
  $to = Call POST "/orders" $waiter @{
    tableId = $free.id
    tableNo = $free.label
    items = @(@{ menuItemId = $item.id; quantity = 1 })
    printKot = $false
    assignedCashierId = $tw.assignedCashierId
  }
  if ($to.status -ne "PENDING") { Bad "table order status=$($to.status)" } else { Ok "table order PENDING" }
  $kitchenList2 = Call GET "/orders/kitchen" $kitTok
  $onKit2 = @($kitchenList2 | Where-Object { $_.id -eq $to.id })
  if ($onKit2.Count -eq 0) { Bad "table order missing from kitchen" } else { Ok "table order on kitchen board" }
  try {
    [void](Call POST "/orders/$($to.id)/cancel" $admin @{ reason = "smoke cleanup table" })
    Ok "table order cancelled cleanup"
  } catch {
    try {
      [void](Call POST "/orders/$($to.id)/cancel" $mainCash @{ reason = "smoke cleanup table" })
      Ok "table order cancelled cleanup (main)"
    } catch {
      Bad "cleanup cancel table failed: $($_.Exception.Message)"
    }
  }
}

Info "pay takeaway"
$due = [math]::Round([double]$tw.total - [double]$tw.discountAmount + [double]$tw.taxAmount - [double]$tw.paidAmount, 2)
$paid = Call POST "/orders/$($tw.id)/pay" $cashier @{
  amount = $due
  method = "CASH"
  tendered = $due
}
if ($paid.paymentStatus -ne "PAID") { Bad "takeaway pay status=$($paid.paymentStatus)" } else { Ok "takeaway PAID" }
if ($paid.status -ne "COMPLETED") { Bad "takeaway after pay status=$($paid.status)" } else { Ok "takeaway COMPLETED after pay" }

Info "bills + hotel day"
$hotel = Call GET "/system/hotel" $admin
$biz = $hotel.businessDate
Ok "businessDate=$biz dayStart=$($hotel.dayStart)"
$billPath = '/orders?view=billing&paymentStatus=PAID&from=' + $biz + '&to=' + $biz
$bills = Call GET $billPath $admin
$found = @($bills | Where-Object { $_.id -eq $tw.id })
if ($found.Count -eq 0) {
  Bad ("paid takeaway missing from bills list (count={0})" -f @($bills).Count)
} else {
  Ok "paid takeaway in bills list"
}

Info "finance close payments"
try {
  $pnl = Call GET ("/finance/day-pnl?date=" + $biz) $admin
  Ok ("finance day-pnl netProfit={0} gross={1}" -f $pnl.netProfit, $pnl.sales.gross)
} catch {
  Bad "finance day-pnl: $($_.Exception.Message)"
}
try {
  $close = Call GET ("/close/preview?date=" + $biz) $admin
  Ok ("close preview payments={0}" -f @($close.payments).Count)
} catch {
  Bad "close preview: $($_.Exception.Message)"
}
try {
  $payPath = '/payments?from=' + $biz + '&to=' + $biz
  $pays = Call GET $payPath $admin
  Ok ("payments list count={0}" -f @($pays).Count)
} catch {
  Bad "payments: $($_.Exception.Message)"
}

Info "edit takeaway stays READY"
$tw2Name = "Smoke-TW-Edit-" + (Get-Random -Maximum 9999)
$tw2 = Call POST "/orders" $cashier @{
  tableNo = $tw2Name
  items = @(@{ menuItemId = $item.id; quantity = 1 })
  printKot = $true
}
$line = $tw2.items | Select-Object -First 1
try {
  $edited = Call POST "/orders/$($tw2.id)/edit" $admin @{
    items = @(@{ id = $line.id; quantity = 2 })
    reason = "smoke edit takeaway qty"
  }
  if ($edited.status -ne "READY") { Bad "edited takeaway status=$($edited.status)" }
  else { Ok "edited takeaway still READY qty ok" }
  $kit3 = Call GET "/orders/kitchen" $kitTok
  if (@($kit3 | Where-Object { $_.id -eq $tw2.id }).Count -gt 0) { Bad "edited takeaway appeared on kitchen" }
  else { Ok "edited takeaway still off kitchen" }
} catch {
  try {
    $edited = Call POST "/orders/$($tw2.id)/edit" $mainCash @{
      items = @(@{ id = $line.id; quantity = 2 })
      reason = "smoke edit takeaway qty"
    }
    if ($edited.status -ne "READY") { Bad "edited takeaway status=$($edited.status)" }
    else { Ok "edited takeaway still READY" }
  } catch {
    Bad "edit takeaway failed: $($_.Exception.Message)"
  }
}
try {
  [void](Call POST "/orders/$($tw2.id)/cancel" $admin @{ reason = "smoke cleanup tw2" })
  Ok "tw2 cancelled"
} catch {
  try {
    [void](Call POST "/orders/$($tw2.id)/cancel" $mainCash @{ reason = "smoke cleanup tw2" })
    Ok "tw2 cancelled"
  } catch {
    Info "tw2 cancel skipped: $($_.Exception.Message)"
  }
}

Write-Host ""
$color = if ($fail -gt 0) { "Red" } else { "Green" }
Write-Host ("==== RESULT: {0} passed, {1} failed ====" -f $pass, $fail) -ForegroundColor $color
if ($fail -gt 0) { exit 1 }
