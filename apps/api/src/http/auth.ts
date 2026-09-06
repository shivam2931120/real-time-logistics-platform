import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { verifyToken } from '@clerk/backend';
import type { Role, User } from '@routepulse/shared';
import { users } from '../domain/store.js';
import { resolveClerkUser } from '../services/clerkIdentity.js';

const secret = () => process.env.JWT_SECRET || 'routepulse-local-development-only';
export const issueToken = (user: User) => jwt.sign({ sub: user.id, org: user.organizationId, role: user.role }, secret(), { expiresIn: '8h', issuer: 'routepulse', audience: 'routepulse-web' });
declare global { namespace Express { interface Request { user?: User } } }
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const raw=req.header('authorization')?.replace(/^Bearer /,''); if(!raw) return res.status(401).json({error:'Authentication required'});
  if (process.env.AUTH_MODE==='clerk') { void verifyToken(raw,{secretKey:process.env.CLERK_SECRET_KEY}).then(resolveClerkUser).then(user=>{req.user=user;next()}).catch(()=>res.status(401).json({error:'Invalid Clerk session'})); return; }
  try { const claims=jwt.verify(raw,secret(),{issuer:'routepulse',audience:'routepulse-web'}) as jwt.JwtPayload; const user=users.find(u=>u.id===claims.sub); if(!user)return res.status(401).json({error:'Unknown identity'}); req.user=user; next(); } catch { return res.status(401).json({error:'Invalid or expired session'}); }
}
export const permit = (...roles: Role[]) => (req: Request,res: Response,next: NextFunction) => roles.includes(req.user!.role) ? next() : res.status(403).json({error:'Insufficient permissions'});
