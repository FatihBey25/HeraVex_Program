Add-Type -AssemblyName PresentationFramework

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$tauriRoot = $root
$portableExePath = Join-Path $tauriRoot "HeraVex.exe"
$releaseExePath = Join-Path $tauriRoot "src-tauri\target\release\studio_hub.exe"
$settingsPath = Join-Path $env:APPDATA "HeraVex\studio-data\settings.json"
$preferredLanguage = "en"
if (Test-Path $settingsPath) {
  try {
    $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
    if ($settings.preferredLanguage) {
      $preferredLanguage = [string]$settings.preferredLanguage
    }
  } catch {}
}

$headline = "Preparing HeraVex"
$body = "Loading games, tasks and build records..."
switch ($preferredLanguage) {
  "tr" {
    $headline = "HeraVex hazirlaniyor"
    $body = "Oyunlar, gorevler ve build kayitlari yukleniyor..."
  }
  "fr" {
    $headline = "Preparation de HeraVex"
    $body = "Chargement des jeux, taches et builds..."
  }
  "es" {
    $headline = "Preparando HeraVex"
    $body = "Cargando juegos, tareas y registros de builds..."
  }
}

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        WindowStartupLocation="CenterScreen"
        WindowStyle="None"
        ResizeMode="NoResize"
        Width="520"
        Height="320"
        Background="#091018"
        Topmost="True"
        ShowInTaskbar="False">
  <Grid Margin="24">
    <Border CornerRadius="26" Background="#141C28" BorderBrush="#2A3342" BorderThickness="1" Padding="24">
      <StackPanel>
        <StackPanel Margin="0,6,0,16">
          <TextBlock Text="HeraVex" Foreground="White" FontSize="34" FontWeight="Bold" TextAlignment="Center" HorizontalAlignment="Center"/>
        </StackPanel>
        <TextBlock Text="$headline" Foreground="#9FB4CF" FontSize="13" HorizontalAlignment="Center" Margin="0,0,0,10"/>
        <TextBlock Text="$body" Foreground="#A9B8CB" FontSize="14" TextAlignment="Center" TextWrapping="Wrap" Margin="10,0,10,18"/>
        <ProgressBar Name="Progress" Height="10" IsIndeterminate="True" Foreground="#4F8CFF" Background="#1F2838"/>
      </StackPanel>
    </Border>
  </Grid>
</Window>
"@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$isReleaseRun = $false
if (Test-Path $portableExePath) {
  $startInfo.FileName = $portableExePath
  $startInfo.WorkingDirectory = Split-Path -Parent $portableExePath
  $isReleaseRun = $true
} elseif (Test-Path $releaseExePath) {
  $startInfo.FileName = $releaseExePath
  $startInfo.WorkingDirectory = Split-Path -Parent $releaseExePath
  $isReleaseRun = $true
} else {
  $startInfo.FileName = "cmd.exe"
  $startInfo.Arguments = "/c cd /d `"$tauriRoot`" && npm run tauri dev"
  $startInfo.WorkingDirectory = $tauriRoot
  $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $startInfo.CreateNoWindow = $true
}

$process = [System.Diagnostics.Process]::Start($startInfo)

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(350)
$script:elapsed = 0
$minimumVisibleMs = 1200
$timer.Add_Tick({
  $script:elapsed += 350
  $ready = $false

  if ($isReleaseRun -and $process -and -not $process.HasExited) {
    try {
      $process.Refresh()
      if ($process.MainWindowHandle -ne 0) {
        $ready = $true
      }
    } catch {}
  } else {
    try {
      $appProcess = Get-Process studio_hub -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($appProcess) {
        $appProcess.Refresh()
        if ($appProcess.MainWindowHandle -ne 0) {
          $ready = $true
        }
      }
    } catch {}
  }

  if (($ready -and $script:elapsed -ge $minimumVisibleMs) -or $script:elapsed -ge 8000) {
    $timer.Stop()
    $window.Close()
  }
})

$window.Add_ContentRendered({
  $timer.Start()
})

$null = $window.ShowDialog()
