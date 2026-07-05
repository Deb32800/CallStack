import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';

const HEADER = 'x-telephone-mcp-secret';

/** Guards the endpoint the mcp-server hits to trigger a dial (§3.4 safety). */
export function requireSharedSecret(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const provided = req.header(HEADER);
  if (!provided || provided !== config.appServer.sharedSecret) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}
