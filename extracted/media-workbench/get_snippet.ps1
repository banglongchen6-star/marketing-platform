$f = [IO.File]::ReadAllText("C:\Users\Admin\.qclaw\workspace\media-workbench\index.html", [Text.Encoding]::UTF8)
$idx = $f.IndexOf('<label class="platform-tag"')
$len = 400
$snippet = $f.Substring($idx, $len)
Write-Host $snippet
Write-Host "---END---"
Write-Host "Length: $($snippet.Length)"