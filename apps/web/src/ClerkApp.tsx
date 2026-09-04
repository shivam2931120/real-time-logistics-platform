import { useEffect, useState } from 'react';
import { SignIn, useAuth } from '@clerk/clerk-react';
import App from './App';
import { api, setToken } from './lib/api';
export default function ClerkApp(){ const {isLoaded,isSignedIn,getToken}=useAuth(); const [ready,setReady]=useState(false); useEffect(()=>{if(!isLoaded||!isSignedIn)return; void getToken().then(value=>{if(value){setToken(value);setReady(true)}})},[getToken,isLoaded,isSignedIn]); if(!isLoaded)return <div className="splash">Loading secure workspace…</div>; if(!isSignedIn)return <div className="clerk-login"><SignIn routing="hash" signUpUrl="#/sign-up"/></div>; if(!ready)return <div className="splash">Authorizing workspace…</div>; return <App key={api.token()}/>; }
