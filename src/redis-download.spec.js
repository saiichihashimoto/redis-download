import { Readable, Writable } from 'stream';
import { createHash } from 'crypto';
import { tmpdir } from 'os';

import execa from 'execa';
import request from 'request';
import requestAsync from 'request-promise-native';
import { createWriteStream, ensureDir, exists, readdir, rename } from 'fs-extra';
import { extract } from 'tar';

import redisDownload from './redis-download';

jest.mock('crypto');
jest.mock('execa');
jest.mock('fs-extra');
jest.mock('os');
jest.mock('request');
jest.mock('request-promise-native');
jest.mock('tar');

const digest = jest.fn();
const update = jest.fn();

const originalPlatform = process.platform;
let requestPipe;
let fileStream;

beforeEach(() => {
	createHash.mockImplementation(() => ({ digest, update }));
	digest.mockImplementation((type) => type === 'hex' && 'THEHASH');
	ensureDir.mockImplementation(() => Promise.resolve());
	execa.mockImplementation(() => Promise.resolve());
	exists.mockImplementation(() => Promise.resolve(false));
	extract.mockImplementation(() => Promise.resolve());
	readdir.mockImplementation(() => Promise.resolve(['redis-a.b.c', 'redis-a.b.c.tar.gz']));
	rename.mockImplementation(() => Promise.resolve());
	requestAsync.mockImplementation((url) => url === 'https://raw.githubusercontent.com/antirez/redis-hashes/master/README' && Promise.resolve('hash redis-u.v.w.tar.gz algo THEHASH http://foo-bar.com/redis-u.v.w.tar.gz\nhash redis-x.y.z.tar.gz algo THEHASH http://foo-bar.com/redis-x.y.z.tar.gz'));
	tmpdir.mockImplementation(() => '/a/tmp/dir');

	jest.spyOn(process.stdout, 'write');

	requestPipe = new Readable();
	requestPipe._read = jest.fn(); // eslint-disable-line no-underscore-dangle
	request.mockImplementation(() => requestPipe);

	fileStream = new Writable();
	fileStream.close = jest.fn().mockImplementation((func) => func());

	createWriteStream.mockImplementation(() => {
		setImmediate(() => {
			fileStream.emit('finish');
		});

		return fileStream;
	});
});

afterEach(() => {
	Object.defineProperty(process, 'platform', { value: originalPlatform });

	jest.resetAllMocks();
});

it('returns location of latest redis download', () => expect(redisDownload()).resolves.toBe('/a/tmp/dir/redis-download/redis-x.y.z'));

it('returns location of (specified) latest redis download', () => expect(redisDownload({ version: 'latest' })).resolves.toBe('/a/tmp/dir/redis-download/redis-x.y.z'));

it('returns location of specified redis download', () => expect(redisDownload({ version: 'u.v.w' })).resolves.toBe('/a/tmp/dir/redis-download/redis-u.v.w'));

it('ignore commented lines', async () => {
	requestAsync.mockImplementation(() => Promise.resolve('hash redis-u.v.w.tar.gz algo THEHASH http://foo-bar.com/redis-u.v.w.tar.gz\n#hash redis-x.y.z.tar.gz algo THEHASH http://foo-bar.com/redis-x.y.z.tar.gz'));

	await expect(redisDownload()).resolves.toBe('/a/tmp/dir/redis-download/redis-u.v.w');
});

describe('request', () => {
	it('requests latest tar', async () => {
		await redisDownload();

		expect(request).toHaveBeenCalledWith('http://foo-bar.com/redis-x.y.z.tar.gz');
	});

	it('requests specified tar', async () => {
		await redisDownload({ version: 'u.v.w' });

		expect(request).toHaveBeenCalledWith('http://foo-bar.com/redis-u.v.w.tar.gz');
	});

	it('doesn\'t request existing tar', async () => {
		readdir.mockImplementation(() => Promise.resolve(['redis-x.y.z.tar.gz']));

		await expect(redisDownload()).resolves.toBe('/a/tmp/dir/redis-download/redis-x.y.z');

		expect(request).not.toHaveBeenCalledWith(expect.anything());
	});

	it('fails if request fails', async () => {
		const err = new Error();
		createWriteStream.mockImplementation(() => fileStream);
		request.mockImplementation(() => {
			setImmediate(() => {
				requestPipe.emit('error', err);
			});

			return requestPipe;
		});

		await expect(redisDownload()).rejects.toBe(err);
	});

	it('fails if hashes don\'t match', async () => {
		digest.mockImplementation(() => 'NOTTHEHASH');

		await expect(redisDownload()).rejects.toThrow('The hashes don\'t match!');
	});

	describe('data', () => {
		let dataReady;
		let promise;
		let inputStream;

		beforeEach(() => {
			inputStream = new Readable();
			inputStream._read = jest.fn(); // eslint-disable-line no-underscore-dangle
			inputStream.headers = { 'content-length': 10485760 };

			createWriteStream.mockImplementation(() => fileStream);

			dataReady = () => new Promise((resolve) => {
				request.mockImplementation(() => {
					setImmediate(() => {
						requestPipe.emit('response', inputStream);
						resolve();
					});

					return requestPipe;
				});

				promise = redisDownload();
			});
		});

		afterEach(async () => {
			fileStream.emit('finish');

			await promise;
		});

		it('updates the hash', async () => {
			await dataReady();

			expect(update).not.toHaveBeenCalledWith(expect.anything());

			for (let i = 0; i < 10; i += 1) {
				const data = { length: 1048576 };
				inputStream.emit('data', data);

				expect(update).toHaveBeenNthCalledWith(i + 1, data);
			}

			const data = { length: 0 };
			inputStream.emit('data', data);

			expect(update).toHaveBeenCalledTimes(11);
		});

		it('writes to stdout', async () => {
			await dataReady();

			expect(process.stdout.write).toHaveBeenNthCalledWith(1, 'Completed: 0 % (0mb / 10mb)\r');

			for (let i = 0; i < 10; i += 1) {
				inputStream.emit('data', { length: 1048576 });

				expect(process.stdout.write).toHaveBeenNthCalledWith(i + 2, `Completed: ${i + 1}0 % (${i + 1}mb / 10mb)\r`);
			}

			inputStream.emit('data', { length: 0 });

			expect(process.stdout.write).toHaveBeenCalledTimes(11);
		});

		it('writes to stdout with win32 newlines', async () => {
			Object.defineProperty(process, 'platform', { value: 'win32' });

			await dataReady();

			expect(process.stdout.write).toHaveBeenNthCalledWith(1, 'Completed: 0 % (0mb / 10mb)\u001B[0G');

			for (let i = 0; i < 10; i += 1) {
				inputStream.emit('data', { length: 1048576 });

				expect(process.stdout.write).toHaveBeenNthCalledWith(i + 2, `Completed: ${i + 1}0 % (${i + 1}mb / 10mb)\u001B[0G`);
			}

			inputStream.emit('data', { length: 0 });

			expect(process.stdout.write).toHaveBeenCalledTimes(11);
		});
	});
});

describe('rename', () => {
	it('requests before renaming', async () => {
		request.mockImplementation(() => {
			expect(rename).not.toHaveBeenCalledWith(expect.anything(), expect.anything());

			return requestPipe;
		});
		rename.mockImplementation(() => {
			expect(request).toHaveBeenCalledWith(expect.anything());

			return Promise.resolve();
		});

		await redisDownload();
	});

	it('renames latest tar', async () => {
		await redisDownload();

		expect(rename).toHaveBeenCalledWith('/a/tmp/dir/redis-download/redis-x.y.z.tar.gz.downloading', '/a/tmp/dir/redis-download/redis-x.y.z.tar.gz');
	});

	it('renames specified tar', async () => {
		await redisDownload({ version: 'u.v.w' });

		expect(rename).toHaveBeenCalledWith('/a/tmp/dir/redis-download/redis-u.v.w.tar.gz.downloading', '/a/tmp/dir/redis-download/redis-u.v.w.tar.gz');
	});

	it('doesn\'t rename existing tar', async () => {
		readdir.mockImplementation(() => Promise.resolve(['redis-x.y.z.tar.gz']));

		await expect(redisDownload()).resolves.toBe('/a/tmp/dir/redis-download/redis-x.y.z');

		expect(rename).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
	});

	it('fails if rename fails', async () => {
		const err = new Error();

		rename.mockImplementation(() => Promise.reject(err));

		await expect(redisDownload()).rejects.toBe(err);
	});
});

describe('extract', () => {
	it('renames before extracting', async () => {
		rename.mockImplementation(() => {
			expect(extract).not.toHaveBeenCalledWith(expect.anything());

			return Promise.resolve();
		});
		extract.mockImplementation(() => {
			expect(rename).toHaveBeenCalledWith(expect.anything(), expect.anything());

			return Promise.resolve();
		});

		await redisDownload();
	});

	it('extracts latest version', async () => {
		await redisDownload();

		expect(extract).toHaveBeenCalledWith(expect.objectContaining({ file: '/a/tmp/dir/redis-download/redis-x.y.z.tar.gz', cwd: '/a/tmp/dir/redis-download' }));
	});

	it('extracts specified version', async () => {
		await redisDownload({ version: 'u.v.w' });

		expect(extract).toHaveBeenCalledWith(expect.objectContaining({ file: '/a/tmp/dir/redis-download/redis-u.v.w.tar.gz', cwd: '/a/tmp/dir/redis-download' }));
	});

	it('doesn\'t extract already extracted version', async () => {
		readdir.mockImplementation(() => Promise.resolve(['redis-x.y.z']));

		await expect(redisDownload()).resolves.toBe('/a/tmp/dir/redis-download/redis-x.y.z');

		expect(extract).not.toHaveBeenCalledWith(expect.anything());
	});

	it('fails if extract fails', async () => {
		const err = new Error();

		extract.mockImplementation(() => Promise.reject(err));

		await expect(redisDownload()).rejects.toBe(err);
	});
});

describe('make', () => {
	it('extracts before making', async () => {
		extract.mockImplementation(() => {
			expect(execa).not.toHaveBeenCalledWith('make', expect.anything());

			return Promise.resolve();
		});
		execa.mockImplementation((cmd) => {
			if (cmd === 'make') {
				expect(extract).toHaveBeenCalledWith(expect.anything());
			}

			return Promise.resolve();
		});

		await redisDownload();
	});

	it('makes latest build', async () => {
		await redisDownload();

		expect(execa).toHaveBeenCalledWith('make', expect.objectContaining({ cwd: '/a/tmp/dir/redis-download/redis-x.y.z', stdio: 'inherit' }));
	});

	it('makes specified build', async () => {
		await redisDownload({ version: 'u.v.w' });

		expect(execa).toHaveBeenCalledWith('make', expect.objectContaining({ cwd: '/a/tmp/dir/redis-download/redis-u.v.w', stdio: 'inherit' }));
	});

	it('doesn\'t make already build', async () => {
		readdir.mockImplementation(() => Promise.resolve(['redis-x.y.z']));
		exists.mockImplementation((binaryName) => Promise.resolve(binaryName.startsWith('/a/tmp/dir/redis-download/redis-x.y.z/src/')));

		await expect(redisDownload()).resolves.toBe('/a/tmp/dir/redis-download/redis-x.y.z');

		expect(execa).not.toHaveBeenCalledWith('make', expect.anything());
	});

	it('remakes if partially built', async () => {
		readdir.mockImplementation(() => Promise.resolve(['redis-x.y.z']));
		exists.mockImplementation((binaryName) => Promise.resolve(binaryName.startsWith('/a/tmp/dir/redis-download/redis-x.y.z/src/redis-benchmark')));

		await expect(redisDownload()).resolves.toBe('/a/tmp/dir/redis-download/redis-x.y.z');

		expect(execa).toHaveBeenCalledWith('make', expect.anything());
	});

	it('fails if make fails', async () => {
		const err = new Error();

		execa.mockImplementation((cmd) => (cmd === 'make' ? Promise.reject(err) : Promise.resolve()));

		await expect(redisDownload()).rejects.toBe(err);
	});
});
