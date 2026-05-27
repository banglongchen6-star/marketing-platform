$f = [IO.File]::ReadAllText("C:\Users\Admin\.qclaw\workspace\media-workbench\index.html", [Text.Encoding]::UTF8)
$old = @"
    .month-picker{position:absolute;background:#fff;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.15);padding:12px;z-index:100;margin-top:8px;}
    .month-picker-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-weight:600;}
    .month-picker-header button{border:none;background:#f0f0f0;border-radius:4px;cursor:pointer;padding:4px 12px;}
    .month-picker-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;}
    .month-picker-grid button{border:1px solid #ddd;background:#fff;border-radius:4px;padding:8px;cursor:pointer;font-size:.8rem;}
    .month-picker-grid button:hover{background:var(--primary-light);}
    .month-picker-grid button.active{background:var(--primary);color:#fff;border-color:var(--primary);}
"@
$n = @"
    .month-picker{display:inline-flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px;width:320px;position:relative;}
    .month-picker-header{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;}
    .month-picker-header span{font-weight:600;font-size:.88rem;min-width:50px;text-align:center;}
    .month-picker-header button{border:none;background:#f0f0f0;border-radius:4px;cursor:pointer;padding:4px 10px;font-size:1rem;}
    .month-picker-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;width:100%;}
    .month-picker-grid button{border:1px solid #ddd;background:#fff;border-radius:4px;padding:6px 4px;cursor:pointer;font-size:.8rem;transition:all .15s;}
    .month-picker-grid button:hover{background:var(--primary-light);}
    .month-picker-grid button.active{background:var(--primary);color:#fff;border-color:var(--primary);}
"@
if ($f.Contains($old)) {
    $f = $f.Replace($old, $n)
    [IO.File]::WriteAllText("C:\Users\Admin\.qclaw\workspace\media-workbench\index.html", $f, [Text.Encoding]::UTF8)
    Write-Host "OK - month picker CSS updated"
} else {
    Write-Host "Not found exactly, trying raw replace at index: $($f.IndexOf('.month-picker'))"
    $idx = $f.IndexOf('.month-picker')
    if ($idx -ge 0) {
        $len = $old.Length
        $f = $f.Remove($idx, $len).Insert($idx, $n)
        [IO.File]::WriteAllText("C:\Users\Admin\.qclaw\workspace\media-workbench\index.html", $f, [Text.Encoding]::UTF8)
        Write-Host "OK via raw replace"
    }
}