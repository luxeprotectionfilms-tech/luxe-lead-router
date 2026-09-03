const app=require('../src/server');const express=require('express');const fs=require('fs');
app.get('/preview',(q,s)=>{s.send('<!doctype html><meta name=viewport content="width=device-width"><body style="margin:0;background:#fff;padding:40px">'+fs.readFileSync(__dirname+'/../public/luxe-installer-form.html','utf8').replace('https://LEAD_ROUTER_HOST','http://127.0.0.1:8090')+'</body>')});
app.listen(8090,()=>console.log('preview :8090'));
