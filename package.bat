@echo off
:: Auto Auth Filler: Windows packaging script
:: Produces chrome and firefox ZIP files ready for store submission.
:: Requires: PowerShell 5+ (built into Windows 10/11)

setlocal enabledelayedexpansion

set "DIST=dist"
set "CHROME_ZIP=auto-auth-filler-chrome.zip"
set "FIREFOX_ZIP=auto-auth-filler-firefox.zip"

echo [1/4] Cleaning dist folder...
if exist "%DIST%" rmdir /s /q "%DIST%"
mkdir "%DIST%"

echo [2/4] Copying extension files...
:: config.js carries your own Client ID and must be present, or the packaged
:: extension cannot authenticate.
set "FILES=manifest.json config.js background.js content.js options.html options.js popup.html popup.js styles.css"
for %%f in (%FILES%) do (
    if exist "%%f" (
        copy "%%f" "%DIST%\%%f" >nul
        echo   Copied %%f
    ) else (
        echo   WARNING: %%f not found
    )
)

:: Copy icons folder
if exist "icons" (
    mkdir "%DIST%\icons"
    xcopy /s /q "icons\*" "%DIST%\icons\" >nul
    echo   Copied icons\
) else (
    echo   WARNING: icons\ folder not found
)

echo [3/4] Creating Chrome ZIP...
if exist "%CHROME_ZIP%" del "%CHROME_ZIP%"
powershell -NoProfile -Command "Compress-Archive -Path '%DIST%\*' -DestinationPath '%CHROME_ZIP%' -Force"
echo   Created %CHROME_ZIP%

echo [4/4] Creating Firefox ZIP (same manifest, gecko settings already embedded)...
if exist "%FIREFOX_ZIP%" del "%FIREFOX_ZIP%"
powershell -NoProfile -Command "Compress-Archive -Path '%DIST%\*' -DestinationPath '%FIREFOX_ZIP%' -Force"
echo   Created %FIREFOX_ZIP%

echo.
echo Done!  Upload auto-auth-filler-chrome.zip to the Chrome Web Store.
echo        Upload auto-auth-filler-firefox.zip to addons.mozilla.org (AMO).
echo.
echo REMINDER: Before packaging for public distribution, make sure config.js
echo           contains YOUR OWN Google OAuth Client ID (see config.template.js).
endlocal
