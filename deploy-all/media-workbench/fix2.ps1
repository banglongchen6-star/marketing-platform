# Fix 2: Content modal - platform tags + "微信" -> "视频号" + three-col for data fields
$f = [IO.File]::ReadAllText("C:\Users\Admin\.qclaw\workspace\media-workbench\index.html", [Text.Encoding]::UTF8)

# Replace platform tags
$old_platform = @"
<label class="platform-tag" onclick="this.classList.toggle('active')"><input type="checkbox" id="cp-douyin" /><span>抖音</span></label>
            <label class="platform-tag" onclick="this.classList.toggle('active')"><input type="checkbox" id="cp-xiaohongshu" /><span>小红书</span></label>
            <label class="platform-tag" onclick="this.classList.toggle('active')"><input type="checkbox" id="cp-bilibili" /><span>B站</span></label>
            <label class="platform-tag" onclick="this.classList.toggle('active')"><input type="checkbox" id="cp-weibo" /><span>微博</span></label>
            <label class="platform-tag" onclick="this.classList.toggle('active')"><input type="checkbox" id="cp-kuaishou" /><span>快手</span></label>
            <label class="platform-tag" onclick="this.classList.toggle('active')"><input type="checkbox" id="cp-weixin" /><span>微信</span></label>
"@

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

if ($f.Contains($old_platform)) {
    $f = $f.Replace($old_platform, $n_platform)
    Write-Host "OK - platform tags updated"
} else {
    Write-Host "Platform tags old text not found exactly"
    $idx = $f.IndexOf('<label class="platform-tag"')
    if ($idx -ge 0) {
        $snippet = $f.Substring($idx, 300)
        Write-Host $snippet
    }
}

[IO.File]::WriteAllText("C:\Users\Admin\.qclaw\workspace\media-workbench\index.html", $f, [Text.Encoding]::UTF8)
Write-Host "Step 2 done"