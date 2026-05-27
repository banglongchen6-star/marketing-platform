$f = [IO.File]::ReadAllText("C:\Users\Admin\.qclaw\workspace\media-workbench\index.html", [Text.Encoding]::UTF8)

# Fix platform tags - replace via index/remove/insert
$idx = $f.IndexOf('<label class="platform-tag"')
# Find end - look for the next </div> after platform tags
$endIdx = $f.IndexOf('</div>', $idx)
Write-Host "Platform start: $idx, end: $endIdx"

$n_platform = @"
<div class="platform-tags">
            <label class="platform-tag"><input type="checkbox" value="抖音" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>抖音</span></label>
            <label class="platform-tag"><input type="checkbox" value="小红书" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>小红书</span></label>
            <label class="platform-tag"><input type="checkbox" value="B站" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>B站</span></label>
            <label class="platform-tag"><input type="checkbox" value="微博" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>微博</span></label>
            <label class="platform-tag"><input type="checkbox" value="快手" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>快手</span></label>
            <label class="platform-tag"><input type="checkbox" value="视频号" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>视频号</span></label>
          </div>
"@

$f = $f.Remove($idx, $endIdx - $idx + 6).Insert($idx, $n_platform)
Write-Host "Platform tags replaced"
[IO.File]::WriteAllText("C:\Users\Admin\.qclaw\workspace\media-workbench\index.html", $f, [Text.Encoding]::UTF8)
Write-Host "Done"