property rex : "'/Applications/Rex Beta.app/Contents/Helpers/Rex Server.app/Contents/MacOS/rex'"
on open theFiles
	do shell script "open -a 'Rex Beta'"
	repeat with f in theFiles
		set p to POSIX path of f
		do shell script rex & " run --label " & quoted form of (name of (info for f)) & " -- nvim " & quoted form of p
	end repeat
end open
on run
	do shell script "open -a 'Rex Beta'; " & rex & " run -- nvim"
end run
