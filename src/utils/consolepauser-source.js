module.exports = String.raw`#include <windows.h>
#include <conio.h>
#include <stdio.h>
#include <string>

namespace {
std::string QuoteArg(const char* arg)
{
    if (!arg) return "\"\"";

    std::string input(arg);
    if (input.empty()) return "\"\"";

    bool needQuotes = false;
    for (char ch : input)
    {
        if (ch == ' ' || ch == '\t' || ch == '"')
        {
            needQuotes = true;
            break;
        }
    }

    if (!needQuotes) return input;

    std::string output;
    output.push_back('"');
    size_t backslashCount = 0;

    for (char ch : input)
    {
        if (ch == '\\')
        {
            ++backslashCount;
            continue;
        }

        if (ch == '"')
        {
            output.append(backslashCount * 2 + 1, '\\');
            output.push_back('"');
            backslashCount = 0;
            continue;
        }

        if (backslashCount)
        {
            output.append(backslashCount, '\\');
            backslashCount = 0;
        }
        output.push_back(ch);
    }

    if (backslashCount)
    {
        output.append(backslashCount * 2, '\\');
    }

    output.push_back('"');
    return output;
}
}

int main(int argc, char** argv)
{
    if (argc < 2)
    {
        printf("Usage: consolePauser <program> [args...]\\n");
        return 1;
    }

    std::string cmdline;
    for (int i = 1; i < argc; ++i)
    {
        if (i > 1) cmdline.push_back(' ');
        cmdline += QuoteArg(argv[i]);
    }

    SetConsoleTitleA(argv[1]);

    STARTUPINFOA startupInfo;
    PROCESS_INFORMATION processInfo;
    ZeroMemory(&startupInfo, sizeof(startupInfo));
    ZeroMemory(&processInfo, sizeof(processInfo));
    startupInfo.cb = sizeof(startupInfo);

    std::string mutableCmdline = cmdline;
    BOOL created = CreateProcessA(
        NULL,
        mutableCmdline.empty() ? NULL : &mutableCmdline[0],
        NULL,
        NULL,
        FALSE,
        0,
        NULL,
        NULL,
        &startupInfo,
        &processInfo
    );

    if (!created)
    {
        DWORD err = GetLastError();
        printf("Failed to start program. Win32Error=%lu\\n", static_cast<unsigned long>(err));
        printf("Press any key to continue.\\n");
        _getch();
        return static_cast<int>(err);
    }

    WaitForSingleObject(processInfo.hProcess, INFINITE);

    DWORD exitCode = 0;
    GetExitCodeProcess(processInfo.hProcess, &exitCode);

    CloseHandle(processInfo.hThread);
    CloseHandle(processInfo.hProcess);

    printf("\\nProcess returned %lu (0x%lX)\\n", static_cast<unsigned long>(exitCode), static_cast<unsigned long>(exitCode));
    printf("Press any key to continue.\\n");
    _getch();

    return static_cast<int>(exitCode);
}
`;