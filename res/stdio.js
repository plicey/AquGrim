// Desktop launchers can close their logging pipes while the app is still running.
for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', function (error) {
        if (error.code !== 'EPIPE') throw error;
    });
}
