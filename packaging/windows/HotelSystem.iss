; Hotel System offline installer. Built by Build-Release.ps1:
;   ISCC /DAppVersion=1.0.0 /DStageDir=..\..\build\stage /DWithDesktop=1 HotelSystem.iss

#define AppName "Hotel System"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef StageDir
  #define StageDir "..\..\build\stage"
#endif
#ifndef WithDesktop
  #define WithDesktop "1"
#endif
#define DesktopExe "PixalBotics Restaurant.exe"

[Setup]
AppId={{8B1E2B0C-5A3F-4C61-9E0B-6F2D7A4C9E11}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Pixalbotics
DefaultDirName={autopf}\HotelSystem
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=..\..\releases
OutputBaseFilename=HotelSystem-Setup-{#AppVersion}
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\scripts\icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
SetupLogging=yes
; SignTool name "HotelSign" is defined at compile time by Build-Release.ps1:
;   ISCC /DHotelDoSign=1 /SHotelSign=wrapper.cmd $f ...
; Inno Setup 6.7+ rejects a no-op SignTool, so unsigned builds omit SignTool entirely.
#ifdef HotelDoSign
SignedUninstaller=yes
SignTool=HotelSign $f
SignToolRetryCount=3
SignToolRetryDelay=2000
#else
SignedUninstaller=no
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
; Same Setup.exe = install OR in-place update. Never uninstall first.
WelcomeLabel2=This will install or UPDATE [name] on your computer.%n%nIf Hotel System is already installed, just continue — restaurant data (menu, orders, stock, users) is kept in ProgramData.%n%nDo NOT uninstall before updating.
FinishedLabel=Setup finished. Your data was kept if this was an update.%n%nIf the server failed to start with a service error, restart the PC and run this Setup again as Administrator.

[Types]
Name: "server"; Description: "Main PC: server + desktop app (install on ONE PC only)"
#if WithDesktop == "1"
Name: "client"; Description: "Additional PC: desktop app only (finds the server automatically)"
#endif
Name: "custom"; Description: "Custom"; Flags: iscustom

[Components]
Name: "server"; Description: "Server (database, printing, tablets)"; Types: server custom
#if WithDesktop == "1"
Name: "desktop"; Description: "Desktop app"; Types: server client custom
#endif

[InstallDelete]
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\desktop"

[Files]
Source: "{#StageDir}\node\*"; DestDir: "{app}\node"; Components: server; Flags: recursesubdirs ignoreversion
Source: "{#StageDir}\pgsql\*"; DestDir: "{app}\pgsql"; Components: server; Flags: recursesubdirs ignoreversion
Source: "{#StageDir}\winsw\*"; DestDir: "{app}\winsw"; Components: server; Flags: recursesubdirs ignoreversion
Source: "{#StageDir}\app\*"; DestDir: "{app}\app"; Components: server; Flags: recursesubdirs ignoreversion
#if WithDesktop == "1"
Source: "{#StageDir}\desktop\*"; DestDir: "{app}\desktop"; Components: desktop; Flags: recursesubdirs ignoreversion
#endif
Source: "{#StageDir}\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "icon.ico"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "{#StageDir}\VERSION"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
#if WithDesktop == "1"
Name: "{group}\{#AppName}"; Filename: "{app}\desktop\{#DesktopExe}"; Components: desktop
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\desktop\{#DesktopExe}"; Components: desktop
#endif
Name: "{group}\Server logs"; Filename: "{commonappdata}\HotelSystem\logs"; Components: server
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
#if WithDesktop == "1"
Filename: "{app}\desktop\{#DesktopExe}"; Description: "Launch Hotel System"; Components: desktop; Flags: postinstall nowait skipifsilent
#endif
Filename: "{commonappdata}\HotelSystem\server-info.txt"; Description: "Show tablet connection details"; Components: server; Flags: postinstall shellexec skipifsilent unchecked

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall.ps1"" -AppDir ""{app}"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveServices"

[UninstallDelete]
Type: files; Name: "{app}\winsw\*.xml"
Type: filesandordirs; Name: "{app}\winsw\*.log"

[Code]
procedure StopService(const Name: String);
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\net.exe'), 'stop ' + Name + ' /y', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  { Upgrade: release locked node.exe / postgres binaries. }
  StopService('HotelSystemAPI');
  StopService('HotelSystemDB');
  Result := '';
end;

function RunSetupScript(const Mode: String): Boolean;
var
  Code: Integer;
  Params: String;
begin
  Params := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\scripts\install.ps1') +
    '" -AppDir "' + ExpandConstant('{app}') + '" -Mode ' + Mode;
  Result := Exec('powershell.exe', Params, '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Mode: String;
  ErrFile: String;
  ErrText: AnsiString;
begin
  if CurStep <> ssPostInstall then Exit;
  if WizardIsComponentSelected('server') then Mode := 'server' else Mode := 'client';
  if Mode = 'server' then
    WizardForm.StatusLabel.Caption := 'Updating server (data kept; migrate only, 1-2 min)...'
  else
    WizardForm.StatusLabel.Caption := 'Configuring desktop app...';
  WizardForm.ProgressGauge.Style := npbstMarquee;
  try
    if not RunSetupScript(Mode) then begin
      ErrFile := ExpandConstant('{commonappdata}\HotelSystem\logs\last-error.txt');
      if LoadStringFromFile(ErrFile, ErrText) then
        MsgBox(String(ErrText), mbError, MB_OK)
      else
        MsgBox('Setup did not complete (server configuration).' + #13#10#13#10 +
          'See log:' + #13#10 +
          ExpandConstant('{commonappdata}\HotelSystem\logs\install.log') + #13#10#13#10 +
          'Run the installer again as Administrator to retry.', mbError, MB_OK);
    end;
  finally
    WizardForm.ProgressGauge.Style := npbstNormal;
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
var
  Info: AnsiString;
begin
  if (CurPageID = wpFinished) and WizardIsComponentSelected('server') then
    if LoadStringFromFile(ExpandConstant('{commonappdata}\HotelSystem\server-info.txt'), Info) then
      WizardForm.FinishedLabel.Caption := String(Info);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep <> usPostUninstall then Exit;
  DataDir := ExpandConstant('{commonappdata}\HotelSystem');
  if not DirExists(DataDir) then Exit;
  if UninstallSilent then Exit;
  if MsgBox('Also delete restaurant data (orders, database, backups)?' + #13#10 +
      DataDir + #13#10#13#10 + 'Choose "No" if you plan to reinstall.',
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
    DelTree(DataDir, True, True, True);
end;
