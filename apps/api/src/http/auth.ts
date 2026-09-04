import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { verifyToken } from '@clerk/backend';
import type { Role, User } from '@routepulse/shared';
import { users } from '../domain/store.js';

const secret = () => process.env.JWT_SECRET || 'routepulse-local-development-only';
export const issueToken = (user: User) => jwt.sign({ sub: user.id, org: user.organizationId, role: user.role }, secret(), { expiresIn: '8h', issuer: 'routepulse', audience: 'routepulse-web' });
declare global { namespace Express { interface Request { user?: User } } }
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const raw=req.header('authorization')?.replace(/^Bearer /,''); if(!raw) return res.status(401).json({error:'Authentication required'});
  if (process.env.AUTH_MODE==='clerk') { void verifyToken(raw,{secretKey:process.env.CLERK_SECRET_KEY}).then(claims=>{const c=claims as jwt.JwtPayload & {org_id?:string;org_role?:string;email?:string;name?:string;first_name?:string};const roleMap:Record<string,Role>={'org:admin':'admin','org:dispatcher':'dispatcher','org:driver':'driver','org:customer':'customer'};req.user={id:String(c.sub),organizationId:String(c.org_id||process.env.DEFAULT_ORGANIZATION_ID||'org_demo'),name:String(c.name||c.first_name||'RoutePulse user'),email:String(c.email||''),role:roleMap[String(c.org_role||'org:customer')]||'customer'};next()}).catch(()=>res.status(401).json({error:'Invalid Clerk session'})); return; }
  try { const claims=jwt.verify(raw,secret(),{issuer:'routepulse',audience:'routepulse-web'}) as jwt.JwtPayload; const user=users.find(u=>u.id===claims.sub); if(!user)return res.status(401).json({error:'Unknown identity'}); req.user=user; next(); } catch { return res.status(401).json({error:'Invalid or expired session'}); }
}
export const permit = (...roles: Role[]) => (req: Request,res: Response,next: NextFunction) => roles.includes(req.user!.role) ? next() : res.status(403).json({error:'Insufficient permissions'});
