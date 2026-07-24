import path from 'node:path';
import { pathToFileURL } from 'node:url';

const webRoot = process.env.PANGU_WEB_REPO
  ? path.resolve(process.env.PANGU_WEB_REPO)
  : path.resolve(process.cwd(), '..', 'TransferAreaInterface');

await import(pathToFileURL(path.join(webRoot, 'scripts', 'check-api-routes.js')).href);
