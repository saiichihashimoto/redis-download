[![current version](https://img.shields.io/npm/v/redis-download.svg)](https://www.npmjs.com/package/redis-download)
[![Build Status](https://travis-ci.org/saiichihashimoto/redis-download.svg?branch=master)](https://travis-ci.org/saiichihashimoto/redis-download)
[![codecov](https://codecov.io/gh/saiichihashimoto/redis-download/branch/master/graph/badge.svg)](https://codecov.io/gh/saiichihashimoto/redis-download)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/) [![Greenkeeper badge](https://badges.greenkeeper.io/saiichihashimoto/redis-download.svg)](https://greenkeeper.io/)

Downloads and builds Redis

# Installation

```bash
npm install --global redis-download
```

# Usage

```bash
redis-download --version 5.0.3 --download-dir /my/download/directory
```

Or:

```javascript
const redisDownload = require('redis-download');

redisDownload({ version: '5.0.3', downloadDir: '/my/download/directory' })
	.then((downloadLocation) => {
		console.log(`Downloaded Redis: ${downloadLocation}`);
	});
```

`version` defaults to the latest version and `downloadDir` defaults to a temporary directory.
