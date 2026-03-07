package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"unsafe"
)

var (
	kernel32            = syscall.NewLazyDLL("kernel32.dll")
	setConsoleTitleProc = kernel32.NewProc("SetConsoleTitleW")
)

func setConsoleTitle(title string) error {
	titlePtr, err := syscall.UTF16PtrFromString(title)
	if err != nil {
		return err
	}
	_, _, err = setConsoleTitleProc.Call(uintptr(unsafe.Pointer(titlePtr)))
	return err
}

func quoteArg(arg string) string {
	if arg == "" {
		return "\"\""
	}

	needQuotes := false
	for _, ch := range arg {
		if ch == ' ' || ch == '\t' || ch == '"' {
			needQuotes = true
			break
		}
	}

	if !needQuotes {
		return arg
	}

	var output strings.Builder
	output.WriteByte('"')

	backslashCount := 0
	for _, ch := range arg {
		if ch == '\\' {
			backslashCount++
			continue
		}

		if ch == '"' {
			for i := 0; i < backslashCount*2+1; i++ {
				output.WriteByte('\\')
			}
			output.WriteByte('"')
			backslashCount = 0
			continue
		}

		for i := 0; i < backslashCount; i++ {
			output.WriteByte('\\')
		}
		backslashCount = 0
		output.WriteRune(ch)
	}

	for i := 0; i < backslashCount*2; i++ {
		output.WriteByte('\\')
	}

	output.WriteByte('"')
	return output.String()
}

func buildCommandLine(args []string) string {
	var parts []string
	for _, arg := range args {
		parts = append(parts, quoteArg(arg))
	}
	return strings.Join(parts, " ")
}

func pause() {
	fmt.Print("Press any key to continue.\n")
	var buf [1]byte
	os.Stdin.Read(buf[:])
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: consolePauser <program> [args...]")
		os.Exit(1)
	}

	program := os.Args[1]
	args := os.Args[2:]

	setConsoleTitle(program)

	cmd := exec.Command(program, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	var exitCode int
	err := cmd.Run()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
				exitCode = status.ExitStatus()
			} else {
				exitCode = 1
			}
			fmt.Printf("\nProcess returned %d (0x%X)\n", exitCode, exitCode)
		} else {
			fmt.Printf("Failed to start program. Error: %v\n", err)
			pause()
			os.Exit(1)
		}
	} else {
		exitCode = 0
		fmt.Printf("\nProcess returned 0 (0x0)\n")
	}

	pause()
	os.Exit(exitCode)
}
