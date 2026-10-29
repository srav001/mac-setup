on runRex(arguments)
	set rexPath to (POSIX path of (path to application support from user domain)) & "com.superlogical.rex/RexServer/Versions/Current/Rex Server.app/Contents/MacOS/rex"
	set rexCommand to "/usr/bin/env -u REX_SESSION -u REX_BLOCK -u REX_SERVER -u REX_CLIENT " & quoted form of rexPath
	do shell script "/usr/bin/open -a 'Rex Beta'"
	set sessionId to do shell script rexCommand & " new --json " & arguments & " | /usr/bin/plutil -extract session_id raw -o - -"
	do shell script rexCommand & " do -s " & quoted form of sessionId & " session.select session_id=" & quoted form of sessionId
end runRex

on open theFiles
	repeat with f in theFiles
		set fileName to quoted form of (name of (info for f))
		my runRex(fileName & " --window " & fileName & " -- /opt/homebrew/bin/nvim -- " & quoted form of (POSIX path of f))
	end repeat
end open

on run
	my runRex("Neovim -- /opt/homebrew/bin/nvim")
end run
