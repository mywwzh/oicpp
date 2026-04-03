module.exports = String.raw`#include <windows.h>
#include <conio.h>
#include <stdio.h>
#include <psapi.h>
#include <stdarg.h>
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

bool QueryPeakWorkingSetBytes(HANDLE processHandle, SIZE_T* outBytes)
{
    if (!outBytes) return false;

    *outBytes = 0;

    HMODULE psapi = LoadLibraryA("psapi.dll");
    if (!psapi) return false;

    using GetProcessMemoryInfoFn = BOOL (WINAPI*)(HANDLE, PPROCESS_MEMORY_COUNTERS, DWORD);
    auto getProcessMemoryInfo = reinterpret_cast<GetProcessMemoryInfoFn>(GetProcAddress(psapi, "GetProcessMemoryInfo"));
    if (!getProcessMemoryInfo)
    {
        FreeLibrary(psapi);
        return false;
    }

    PROCESS_MEMORY_COUNTERS counters;
    ZeroMemory(&counters, sizeof(counters));
    counters.cb = sizeof(counters);

    BOOL ok = getProcessMemoryInfo(processHandle, &counters, sizeof(counters));
    if (ok)
    {
        *outBytes = counters.PeakWorkingSetSize;
    }

    FreeLibrary(psapi);
    return ok == TRUE;
}

void PrintConsoleLine(const wchar_t* line)
{
    if (!line) return;

    HANDLE outputHandle = GetStdHandle(STD_OUTPUT_HANDLE);
    DWORD mode = 0;
    if (outputHandle != INVALID_HANDLE_VALUE && GetConsoleMode(outputHandle, &mode))
    {
        DWORD written = 0;
        WriteConsoleW(outputHandle, line, static_cast<DWORD>(wcslen(line)), &written, NULL);
        WriteConsoleW(outputHandle, L"\r\n", 2, &written, NULL);
        return;
    }

    // Fallback for redirected output streams.
    fprintf(stdout, "%ls\n", line);
}

void PrintConsoleFormat(const wchar_t* fmt, ...)
{
    if (!fmt) return;

    wchar_t buffer[512];
    va_list args;
    va_start(args, fmt);
    _vsnwprintf_s(buffer, _countof(buffer), _TRUNCATE, fmt, args);
    va_end(args);

    PrintConsoleLine(buffer);
}
}

int main(int argc, char** argv)
{
    if (argc < 2)
    {
        PrintConsoleLine(L"\u7528\u6cd5: consolePauser <\u7a0b\u5e8f> [\u53c2\u6570...]");
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
        PrintConsoleFormat(L"\u542f\u52a8\u7a0b\u5e8f\u5931\u8d25\uff0cWin32\u9519\u8bef\u7801=%lu", static_cast<unsigned long>(err));
        PrintConsoleLine(L"\u8bf7\u6309\u4efb\u610f\u952e\u7ee7\u7eed\u3002");
        _getch();
        return static_cast<int>(err);
    }

    ULONGLONG startTick = GetTickCount64();
    WaitForSingleObject(processInfo.hProcess, INFINITE);
    ULONGLONG endTick = GetTickCount64();
    unsigned long long elapsedMs = static_cast<unsigned long long>(endTick - startTick);

    DWORD exitCode = 0;
    GetExitCodeProcess(processInfo.hProcess, &exitCode);

    SIZE_T peakMemoryBytes = 0;
    bool hasPeakMemory = QueryPeakWorkingSetBytes(processInfo.hProcess, &peakMemoryBytes);

    CloseHandle(processInfo.hThread);
    CloseHandle(processInfo.hProcess);

    PrintConsoleLine(L"");
    PrintConsoleFormat(L"\u8fdb\u7a0b\u5df2\u7ed3\u675f\uff0c\u8fd4\u56de\u503c %lu (0x%lX)", static_cast<unsigned long>(exitCode), static_cast<unsigned long>(exitCode));
    PrintConsoleFormat(L"\u8fd0\u884c\u65f6\u95f4: %llu ms", elapsedMs);
    if (hasPeakMemory)
    {
        const unsigned long long peakMemoryKb = static_cast<unsigned long long>((peakMemoryBytes + 1023) / 1024);
        PrintConsoleFormat(L"\u5cf0\u503c\u5185\u5b58: %llu KB", peakMemoryKb);
    }
    else
    {
        PrintConsoleLine(L"\u5cf0\u503c\u5185\u5b58: \u65e0\u6cd5\u83b7\u53d6");
    }
    PrintConsoleLine(L"\u8bf7\u6309\u4efb\u610f\u952e\u7ee7\u7eed\u3002");
    _getch();

    return static_cast<int>(exitCode);
}
`;