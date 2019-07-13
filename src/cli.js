#!/usr/bin/env node
/* istanbul ignore file */
import program from 'commander';
import updateNotifier from 'update-notifier';

import pkg from '../package.json';
import redisDownload from './redis-download';

updateNotifier({ pkg }).notify();

program
	.version(pkg.version)
	.option('--download-dir <downloadDir>', 'Download path')
	.option('--version <version>', 'Redis version to download, "latest" is by default', 'latest')
	.parse(process.argv);

redisDownload(program)
	.then((redisDirectory) => console.log(redisDirectory)) // eslint-disable-line no-console
	.catch((err) => { // eslint-disable-line promise/prefer-await-to-callbacks
		console.error(err); // eslint-disable-line no-console

		process.exit(err.code || 1);
	});
