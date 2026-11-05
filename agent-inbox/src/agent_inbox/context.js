/* Optional session details from GET /api/context. Scoped to the selected root; never inferred or merged across roots. */
function decodeContext(raw) {
  const ok=raw && typeof raw==='object' && optional(raw.account,account=>typeof account==='object' &&
      optional(account.identity,isText) && optional(account.email,isText) && optional(account.plan,isText) && isText(account.scope) &&
      (account.quota_identity===undefined || optional(account.quota_identity,isText))) &&
    (raw.ordinary_usage_allowed===undefined || optional(raw.ordinary_usage_allowed,v=>typeof v==='boolean')) &&
    list(raw.quotas,q=>isText(q.label) && isNumber(q.used_percent) && optional(q.window_minutes,isNumber) && optional(q.resets_at,isNumber) &&
      (q.spend_control_reached===undefined || optional(q.spend_control_reached,v=>typeof v==='boolean')) &&
      (q.rate_limit_reached_type===undefined || optional(q.rate_limit_reached_type,v=>[
        'rate_limit_reached','workspace_owner_credits_depleted','workspace_member_credits_depleted',
        'workspace_owner_usage_limit_reached','workspace_member_usage_limit_reached'].includes(v)))) &&
    list(raw.metrics,m=>isText(m.label) && isNumber(m.value) && isText(m.unit)) &&
    list(raw.workers,w=>isText(w.id) && isText(w.label) && isText(w.status) && optional(w.model,isText)) &&
    list(raw.tools,t=>isText(t.name) && isText(t.status) && optional(t.tool_count,isNumber)) &&
    Array.isArray(raw.notices) && raw.notices.every(isText) && isNumber(raw.fetched_at) &&
    (raw.origin===undefined || raw.origin===null || readOrigin(raw.origin)!==null);
  if(!ok) throw new Error('Session details were not in a recognized format.');
  return raw;
}
function windowLabel(minutes) {
  if(minutes==null) return '';
  if(minutes%10080===0) return minutes===10080 ? 'weekly' : minutes/10080+' wk';
  if(minutes%1440===0) return minutes/1440+' d';
  if(minutes%60===0) return minutes/60+' h';
  return minutes+' min';
}
function resetLabel(seconds, now=Date.now()) {
  const at=new Date(seconds*1000), ahead=seconds*1000-now;
  if(ahead<=0) return 'Reset time passed';
  const total=Math.max(1,Math.round(ahead/60000));  // round once, then split: never "60 m"
  const days=Math.floor(total/1440), hours=Math.floor(total%1440/60), minutes=total%60;
  const left=days ? days+' d'+(hours ? ' '+hours+' h' : '') : hours ? hours+' h'+(minutes ? ' '+minutes+' m' : '') : minutes+' m';
  const clock=at.toLocaleString([],ahead<20*3600000 ? {hour:'numeric',minute:'2-digit'} : {weekday:'short',hour:'numeric',minute:'2-digit'});
  return 'Resets '+clock+' · in '+left;
}
class ContextPanel {
  /* `lookup(id)` returns a currently listed root or undefined; `open(root)` is the app's own root selection. */
  constructor(api, current, lookup, open) {
    this.api=api; this.current=current; this.lookup=lookup; this.open=open; this.cache=new Map(); this.request=0; this.loading=false;
  }
  reset() { this.request++; this.loading=false; this.show(this.cache.get(this.current()?.id),'',true); }
  async load() {
    const root=this.current(); if(document.hidden || !root || this.loading) return;
    const version=++this.request, cached=this.cache.get(root.id);
    this.loading=true;
    this.show(cached, cached ? 'Refreshing…' : 'Loading…',!!cached);
    try {
      const data=decodeContext(await this.api('/api/context?id='+encodeURIComponent(root.id)));
      if(document.hidden || this.current()?.id!==root.id || version!==this.request) return;
      this.cache.set(root.id,data);
      this.show(data);
    } catch(error) {
      if(this.current()?.id===root.id && version===this.request) this.show(cached,error.message,true);
    } finally { if(version===this.request) this.loading=false; }
  }
  show(data, message='', stale=false) {
    const body=$('details-body'); body.textContent='';
    if(message) body.append(el('p',{class:'muted',role:'status',text:message}));
    const origin=readOrigin(data?.origin) || readOrigin(this.current()?.origin);
    if(origin) body.append(this.graph(origin));
    if(!data) return;
    const {account,quotas,metrics,workers,tools,notices}=data;
    if(account) {
      const name=account.email || account.identity;
      body.append(el('section',{class:'detail'},el('h3',{text:'Account'}),
        name ? el('p',{class:'account-name',text:name}) : null,
        account.plan ? el('p',{class:'pill',text:account.plan}) : null,
        account.quota_identity && account.quota_identity!==account.identity ?
          el('p',{class:'muted small',text:'Usage snapshot account: '+account.quota_identity}) : null,
        el('p',{class:'muted small',text:stale ? 'Account in the last reading. Refresh to confirm the current connection.' : account.scope==='connection' ?
          'Account of the current connection. It may differ from the account used for earlier turns.' : account.scope})));
    }
    if(account || quotas.length) body.append(el('section',{class:'detail'},el('h3',{text:'Usage limits'}),
      el('p',{class:'small',text:stale ? 'Current included usage is unconfirmed. Showing the last reading.' : data.ordinary_usage_allowed===false ? 'Ordinary included usage is blocked.' :
        data.ordinary_usage_allowed===true ? 'The provider permits ordinary included usage.' : 'Ordinary included usage is unconfirmed.'}),
      quotas.map(q=>this.quota(q,data.ordinary_usage_allowed,stale))));
    if(metrics.length) body.append(el('section',{class:'detail'},el('h3',{text:'This session'}),
      el('dl',{class:'metrics'},metrics.map(m=>[el('dt',{text:m.label}),el('dd',{text:m.value.toLocaleString()+(m.unit ? ' '+m.unit : '')})]))));
    if(workers.length) body.append(el('section',{class:'detail'},el('h3',{text:'Sub-agents'}),
      el('ul',{class:'rows'},workers.map(w=>el('li',{data:{status:stale ? 'unknown' : w.status}},el('span',{text:w.label}),
        el('small',{text:[w.model,(stale ? 'Last seen: ' : '')+statusText(w.status)].filter(Boolean).join(' · ')}))))));
    if(tools.length) body.append(el('section',{class:'detail'},el('h3',{text:'Tools'}),
      el('ul',{class:'rows'},tools.map(t=>el('li',{data:{status:stale ? 'unknown' : t.status}},el('span',{text:t.name}),
        el('small',{text:[t.tool_count!=null ? t.tool_count+' tools' : null,(stale ? 'Last seen: ' : '')+statusText(t.status)].filter(Boolean).join(' · ')}))))));
    for(const notice of notices) body.append(el('p',{class:'muted small',text:notice}));
    if(!origin && !account && !quotas.length && !metrics.length && !workers.length && !tools.length && !notices.length) {
      body.append(el('p',{class:'muted',text:'This connection does not report session details.'}));
    }
    body.append(el('p',{class:'muted small',text:'Updated '+new Date(data.fetched_at*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}));
  }
  /* Launch chain, only from what the origin states: [known parent] -> launcher -> this session. No parent, no first node. */
  graph(origin) {
    const here=this.current(), parent=origin.parent, parentRoot=parent?.id ? this.lookup(parent.id) : undefined;
    const node=(mark, name, sub, extra={}) => el(extra.open ? 'button' : 'div',{class:'node'+(extra.here ? ' here' : '')+(extra.open ? ' link' : ''),
      type:extra.open ? 'button' : null,onclick:extra.open || null,'aria-current':extra.here ? 'true' : null,
      'aria-label':extra.open ? 'Open '+name : null},mark,el('span',{class:'node-text'},el('strong',{text:name}),sub ? el('small',{text:sub}) : null));
    const rows=[];
    if(parent) rows.push(node(brandMark(parent.harness,{size:'sm'}),parent.label || parent.harness,parent.label ? parent.harness : '',
      parentRoot ? {open:()=>this.open(parentRoot)} : {}));
    rows.push(node(el('span',{class:'mark sm tool'},el('span',{class:'face'},icon('worker'))),origin.tool,origin.job));
    rows.push(node(brandMark(here?.harness,{size:'sm'}),origin.title || here?.label || '',here?.harness || '',{here:true}));
    return el('section',{class:'detail'},el('h3',{text:'Started by'}),el('ol',{class:'graph','aria-label':'Where this session came from'},
      rows.map(row=>el('li',{},row))));
  }
  quota(q,allowed,stale=false) {
    const used=q.used_percent, over=used>100, width=Math.min(100,Math.max(0,used));
    const label=[q.label,windowLabel(q.window_minutes)].filter(Boolean).join(' · ');
    const reason=own({rate_limit_reached:'Usage limit reached',workspace_owner_credits_depleted:'Workspace owner credits depleted',
      workspace_member_credits_depleted:'Workspace member credits depleted',workspace_owner_usage_limit_reached:'Workspace owner usage limit reached',
      workspace_member_usage_limit_reached:'Workspace member usage limit reached'},q.rate_limit_reached_type);
    const blocked=!stale && (allowed===false || q.spend_control_reached===true || !!reason);
    const state=stale ? 'unknown' : blocked ? 'blocked' : allowed===true ? 'allowed' : 'unknown';
    return el('div',{class:'quota',data:{usage:state,level:stale ? 'stale' : over ? 'over' : used>=90 ? 'high' : 'ok'}},
      el('div',{class:'quota-head'},el('span',{text:label}),el('strong',{text:used+'% used'+(over && !stale ? ' · over limit' : '')})),
      reason || q.spend_control_reached===true ? el('p',{class:'small',text:
        (stale ? 'Last reading: ' : '')+[q.spend_control_reached===true ? 'Spend control reached' : '',reason || ''].filter(Boolean).join(' · ')}) : null,
      el('div',{class:'bar',role:'meter','aria-label':label,'aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':width,
        'aria-valuetext':used+'% used'+(over ? ', over limit' : '')+', '+(stale ? 'last reading, current usage unconfirmed' : blocked ? 'usage limited' :
          allowed===true ? 'ordinary included usage permitted' : 'ordinary included usage unconfirmed')},el('i',{style:{width:width+'%'}})),
      q.resets_at!=null || stale ? el('small',{class:'muted',text:
        [stale ? 'Last reading' : '',q.resets_at!=null ? resetLabel(q.resets_at) : ''].filter(Boolean).join(' · ')}) : null);
  }
}
