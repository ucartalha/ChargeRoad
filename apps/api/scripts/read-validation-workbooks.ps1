param([string]$SourceDirectory, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Read-EntryXml($Archive, [string]$Name) {
  $entry = $Archive.GetEntry($Name)
  if ($null -eq $entry) { return $null }
  $stream = $entry.Open()
  try {
    $settings = New-Object System.Xml.XmlReaderSettings
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [System.Xml.XmlReader]::Create($stream, $settings)
    try { $doc = New-Object System.Xml.XmlDocument; $doc.Load($reader); return ,$doc } finally { $reader.Dispose() }
  } finally { $stream.Dispose() }
}
$books = @()
foreach ($name in @('ChargeRoad_13_EV_Sarj_Egrileri_Dogrulanmis.xlsx', 'ChargeRoad_13_EV_Tuketim_Dogrulanmis.xlsx')) {
  $path = Join-Path $SourceDirectory $name
  $archive = [System.IO.Compression.ZipFile]::OpenRead($path)
  try {
    $strings = @()
    $shared = Read-EntryXml $archive 'xl/sharedStrings.xml'
    if ($null -ne $shared) { foreach ($item in $shared.SelectNodes('//*[local-name()="si"]')) { $strings += $item.InnerText } }
    $workbook = Read-EntryXml $archive 'xl/workbook.xml'
    $rels = Read-EntryXml $archive 'xl/_rels/workbook.xml.rels'
    $sheets = @()
    foreach ($sheet in $workbook.SelectNodes('//*[local-name()="sheet"]')) {
      $id = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
      $relationship = $rels.SelectSingleNode("//*[local-name()='Relationship'][@Id='$id']")
      $target = $relationship.GetAttribute('Target')
      if ($target.StartsWith('/')) { $target = $target.TrimStart('/') } else { $target = 'xl/' + $target }
      $doc = Read-EntryXml $archive $target
      $rows = @()
      foreach ($row in $doc.SelectNodes('//*[local-name()="sheetData"]/*[local-name()="row"]')) {
        $cells = [ordered]@{}
        foreach ($cell in $row.SelectNodes('*[local-name()="c"]')) {
          $type = $cell.GetAttribute('t'); $v = $cell.SelectSingleNode('*[local-name()="v"]')
          $value = if ($null -eq $v) { $null } else { $v.InnerText }
          if ($type -eq 's') { $value = $strings[[int]$value] }
          elseif ($type -eq 'inlineStr') { $value = $cell.SelectSingleNode('*[local-name()="is"]').InnerText }
          elseif ($type -eq '' -or $type -eq 'n') { if ($null -ne $value) { $value = [double]::Parse($value, [Globalization.CultureInfo]::InvariantCulture) } }
          # Formulas are never executed. Preserve them separately from any cached value.
          $formula = $cell.SelectSingleNode('*[local-name()="f"]')
          $cells[$cell.GetAttribute('r')] = @{ value = $value; formula = $(if ($null -eq $formula) { $null } else { $formula.InnerText }) }
        }
        $rows += @{ row = [int]$row.GetAttribute('r'); cells = $cells }
      }
      $sheets += @{ name = $sheet.GetAttribute('name'); rows = $rows }
    }
    $books += @{ name = $name; sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant(); sheets = $sheets }
  } finally { $archive.Dispose() }
}
$output = @{ schemaVersion = 'workbook-evidence/1.0.0'; purpose = 'User-supplied independent validation, not production calibration or proof of redistribution rights'; books = $books } | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($OutputPath, $output, (New-Object System.Text.UTF8Encoding($false)))
foreach ($book in $books) { foreach ($sheet in $book.sheets) { Write-Output ($book.name + ' | ' + $sheet.name + ' | rows=' + $sheet.rows.Count) } }
