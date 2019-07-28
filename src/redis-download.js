import path from 'path';
import { createHash } from 'crypto';
import { tmpdir } from 'os';

import execa from 'execa';
import request from 'request';
import requestAsync from 'request-promise-native';
import { createWriteStream, ensureDir, exists, readdir, rename } from 'fs-extra';
import { extract } from 'tar';

const redisHashesUrl = 'https://raw.githubusercontent.com/antirez/redis-hashes/master/README';
const binaryNames = [
	'redis-benchmark',
	'redis-check-aof',
	'redis-check-rdb',
	'redis-cli',
	'redis-sentinel',
	'redis-server',
];

async function getRedisHashes() {
	return (await requestAsync(redisHashesUrl))
		.split('\n')
		.filter((line) => line && line.charAt(0) !== '#')
		.map((line) => line.split(/\s+/u))
		.map(([, tarName, algo, digest, url]) => ({ tarName, algo, digest, url }));
}

function downloadTar({ filename, algo, digest, url, stdio: [, stdout] }) {
	return new Promise((resolve, reject) => {
		const fileStream = createWriteStream(filename);
		const hash = createHash(algo);

		request(url)
			.on('response', (response) => {
				const total = parseInt(response.headers['content-length'], 10);
				const totalMB = Math.round((10 * total) / 1048576) / 10;
				let completed = 0;
				const generateOutput = () => `Completed: ${Math.round((1000 * completed) / total) / 10} % (${Math.round((10 * completed) / 1048576) / 10}mb / ${totalMB}mb)${process.platform === 'win32' ? '\u001B[0G' : '\r'}`;

				let lastStdout = generateOutput();
				if (stdout) {
					stdout.write(lastStdout);
				}

				response.on('data', (chunk) => {
					hash.update(chunk);
					completed += chunk.length;
					const text = generateOutput(completed);
					if (lastStdout !== text) {
						lastStdout = text;
						if (stdout) {
							stdout.write(text);
						}
					}
				});
			})
			.on('error', reject)
			.pipe(fileStream);

		fileStream.on('finish', () => {
			fileStream.close(() => {
				if (hash.digest('hex') === digest) {
					resolve();
				} else {
					reject(new Error('The hashes don\'t match!'));
				}
			});
		});
	});
}

export default async function redisDownload({
	version: specifiedVersion,
	downloadDir = tmpdir(),
	stdio = [process.stdin, process.stdout, process.stderr],
} = {}) {
	const root = path.resolve(downloadDir, 'redis-download');

	await ensureDir(root);

	let redisHashes;
	let version = specifiedVersion;

	if (!version || version === 'latest') {
		redisHashes = await getRedisHashes();

		version = redisHashes[redisHashes.length - 1]
			.tarName
			.match(/^(redis-)?(?<version>.*?)(.tar.gz)?$/u)
			.groups.version;
	}

	const contents = (await readdir(root))
		.filter((filename) => filename.match(new RegExp(`^(redis-)?${version}`, 'u')))
		.sort()
		.map((filename) => path.resolve(root, filename));

	let redisDirectory = contents.find((filename) => !filename.endsWith('.tar.gz'));

	if (redisDirectory) {
		if ((await Promise.all(binaryNames.map((binaryName) => exists(path.resolve(redisDirectory, 'src', binaryName))))).every((binaryExists) => binaryExists)) {
			return redisDirectory;
		}
	} else {
		let tar = contents.find((filename) => filename.endsWith('.tar.gz'));

		if (!tar) {
			const { tarName, algo, digest, url } = (redisHashes || await getRedisHashes())
				.find(({ tarName: filename }) => filename.match(new RegExp(`^(redis-)?${version}.tar.gz$`, 'u')));

			tar = path.resolve(root, tarName);
			const temp = `${tar}.downloading`;

			await downloadTar({ filename: temp, algo, digest, url, stdio });

			await rename(temp, tar);
		}

		await extract({ file: tar, cwd: root });

		redisDirectory = tar.replace(/\.tar\.gz$/u, '');
	}

	await execa('make', { cwd: redisDirectory, stdio });

	return redisDirectory;
}
