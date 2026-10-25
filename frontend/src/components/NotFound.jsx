import React from 'react'
import { Link } from 'react-router-dom'
import logo from './logo-192.png'

export default function NotFound() {
  return <main style={{maxWidth:560,margin:'12vh auto',padding:32,textAlign:'center',color:'#143d32'}}>
    <img src={logo} alt="Loyalty Tree" width="72" height="72"/>
    <p style={{letterSpacing:3,fontSize:13}}>404 · PAGE NOT FOUND</p>
    <h1>This branch leads somewhere else.</h1>
    <p>The page may have moved, or the link may be incomplete.</p>
    <p><Link to="/">Back to Loyalty Tree</Link> · <Link to="/contact">Get help</Link></p>
  </main>
}
