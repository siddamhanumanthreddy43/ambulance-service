@echo off
title Push AMBU-ROUTEX to GitHub
color 0A
echo ============================================================
echo   Pushing AMBU-ROUTEX to GitHub
echo   Repository: https://github.com/siddamhanumanthreddy43/ambulance-service
echo ============================================================
echo.
echo If a GitHub login window or browser tab opens, click "Sign in" to authorize.
echo.
"C:\Program Files\Git\cmd\git.exe" push -u origin main --force
if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================================
    echo   SUCCESS! All project files have been uploaded to GitHub:
    echo   https://github.com/siddamhanumanthreddy43/ambulance-service
    echo ============================================================
) else (
    echo.
    echo If prompted, please complete the GitHub sign-in in your browser.
)
echo.
pause
