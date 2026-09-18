const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderDemoPage(opts: { baseUrl: string; demo: { price: string; payTo: string } | undefined }): string {
  const base = escape(opts.baseUrl.replace(/\/+$/, ''));
  const route = `${base}/demo/usds-snapshot`;
  const buyer = `import { x402Client } from '@x402/core/client';
import { toClientEvmSigner } from '@x402/evm';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum } from 'viem/chains';

const account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY);
const rpcUrl = 'https://arb1.arbitrum.io/rpc';
const publicClient = createPublicClient({ chain: arbitrum, transport: http(rpcUrl) });

const client = new x402Client()
  .register('eip155:42161', new ExactEvmScheme(toClientEvmSigner(account, publicClient), { rpcUrl }))
  .setSpendControls({ allowedAssets: [{
    network: 'eip155:42161',
    asset: '0xD74f5255D557944cf7Dd0E45FF521520002D5748',
    maxAmountPerPayment: '10000000000000000', // 0.01 USDs
  }] });

const res = await wrapFetchWithPayment(fetch, client)('${route}');
console.log(res.status, await res.json());`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>USDs over x402</title>
<meta name="description" content="AI agents pay for APIs in Sperax USDs over the x402 protocol on Arbitrum One. Live settlements, a paid demo endpoint, and copy-paste code.">
<style>
:root{--bg:#f7f8fa;--surface:#fff;--text:#12151a;--muted:#5b6472;--line:#e3e6eb;--accent:#1f6feb;--accent-ink:#fff;--code:#0f1720;--code-ink:#e6edf3;--ok:#1a7f37;--radius:14px}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0b0e13;--surface:#12161d;--text:#e8ecf2;--muted:#9aa4b2;--line:#232a35;--accent:#4c8dff;--accent-ink:#0b0e13;--code:#070a0e;--code-ink:#dbe3ec;--ok:#3fb950}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:48px 16px 80px}
h1{font-size:clamp(28px,5vw,44px);line-height:1.1;margin:0 0 12px;letter-spacing:-.02em}
h2{font-size:20px;margin:40px 0 12px}
p.lead{color:var(--muted);font-size:18px;max-width:680px;margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:28px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:18px}
.card .k{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.06em}
.card .v{font-size:28px;font-weight:650;margin-top:6px;font-variant-numeric:tabular-nums}
.skeleton{display:inline-block;width:80px;height:28px;border-radius:8px;background:linear-gradient(90deg,var(--line),transparent,var(--line));background-size:200% 100%;animation:sh 1.2s infinite}
@keyframes sh{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.skeleton{animation:none}}
ol.steps{padding-left:20px;color:var(--muted)}ol.steps li{margin:6px 0}ol.steps b{color:var(--text)}
pre{background:var(--code);color:var(--code-ink);border-radius:var(--radius);padding:18px;overflow-x:auto;font-size:13px;line-height:1.5;margin:0}
.codewrap{position:relative}
button.copy{position:absolute;top:10px;right:10px;background:var(--surface);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;font-size:13px;cursor:pointer;transition:transform .1s,background .15s}
button.copy:hover{background:var(--bg)}button.copy:active{transform:scale(.97)}
button.copy:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
table{width:100%;border-collapse:collapse;font-size:14px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
.tablewrap{overflow-x:auto;border-radius:var(--radius)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.empty,.error{background:var(--surface);border:1px dashed var(--line);border-radius:var(--radius);padding:20px;color:var(--muted)}
.error{border-style:solid}
.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:13px;color:var(--muted)}
footer{margin-top:48px;color:var(--muted);font-size:14px}
</style>
</head>
<body>
<main>
<span class="pill">Arbitrum One &middot; x402 v2</span>
<h1>AI agents pay for APIs in USDs</h1>
<p class="lead">x402 lets software pay for an API over plain HTTP. With USDs, an agent's budget earns auto-yield (a variable rate, capped at 25% APR) until the moment it is spent, and a new wallet needs no ETH to start.</p>

<div class="grid" aria-live="polite">
  <div class="card"><div class="k">USDs payments settled</div><div class="v" id="s-count"><span class="skeleton"></span></div></div>
  <div class="card"><div class="k">USDs volume</div><div class="v" id="s-volume"><span class="skeleton"></span></div></div>
  <div class="card"><div class="k">Paying wallets</div><div class="v" id="s-payers"><span class="skeleton"></span></div></div>
  <div class="card"><div class="k">Receiving wallets</div><div class="v" id="s-payees"><span class="skeleton"></span></div></div>
</div>

<h2>Recent settlements</h2>
<div id="recent"><div class="empty">Loading settlements from Arbitrum One&hellip;</div></div>

<h2>Try it</h2>
${
  opts.demo
    ? `<p>This endpoint sells a live USDs supply snapshot for <b>${escape(opts.demo.price)} USDs</b>. Unpaid requests get <code>402</code> with the offer.</p>
<ol class="steps"><li><b>Ask.</b> <code>curl -i ${route}</code> returns 402 and a <code>PAYMENT-REQUIRED</code> header.</li><li><b>Pay.</b> Run the script below with a wallet holding a little USDs. No ETH needed: the first-time Permit2 approval is sponsored.</li><li><b>Receive.</b> The data comes back with a settlement receipt, and the payment appears in the table above.</li></ol>
<div class="codewrap"><button class="copy" data-copy="buyer" aria-label="Copy buyer script">Copy</button><pre id="buyer">${escape(buyer)}</pre></div>`
    : `<div class="empty">The paid demo endpoint is not enabled on this deployment. Set <code>DEMO_PAY_TO</code> to turn it on.</div>`
}

<h2>For sellers</h2>
<p>Price any route in USDs with the standard x402 middleware and point it at this facilitator: <code>${base}</code>. The asset settings to publish are at <a href="${base}/assets">/assets</a>, and supported payment kinds at <a href="${base}/supported">/supported</a>.</p>

<footer>Settlement data is read directly from Arbitrum One: USDs transfers inside x402 Permit2 proxy settlements, by any facilitator. Raw JSON at <a href="${base}/stats">/stats</a>.</footer>
</main>
<script>
const fmt=(v,d)=>Number(v).toLocaleString(undefined,{maximumFractionDigits:d});
const short=a=>a.slice(0,6)+'\\u2026'+a.slice(-4);
async function load(){
  try{
    const r=await fetch('${base}/stats');
    if(!r.ok)throw new Error('HTTP '+r.status);
    const s=await r.json();
    document.getElementById('s-count').textContent=fmt(s.settlements,0);
    document.getElementById('s-volume').textContent=fmt(s.volumeFormatted,4);
    document.getElementById('s-payers').textContent=fmt(s.uniquePayers,0);
    document.getElementById('s-payees').textContent=fmt(s.uniquePayees,0);
    const el=document.getElementById('recent');
    if(!s.recent.length){el.innerHTML='<div class="empty">No USDs payments settled over x402 yet since block '+s.fromBlock+'. Run the script below to make the first one.</div>';return}
    el.innerHTML='<div class="tablewrap"><table><thead><tr><th>Transaction</th><th>Amount</th><th>Payer</th><th>Paid to</th><th>Block</th></tr></thead><tbody>'+s.recent.map(x=>'<tr><td><a href="https://arbiscan.io/tx/'+x.transaction+'" rel="noopener" target="_blank">'+short(x.transaction)+'</a></td><td>'+fmt(x.amountFormatted,6)+' USDs</td><td><a href="https://arbiscan.io/address/'+x.payer+'" rel="noopener" target="_blank">'+short(x.payer)+'</a></td><td><a href="https://arbiscan.io/address/'+x.payTo+'" rel="noopener" target="_blank">'+short(x.payTo)+'</a></td><td>'+x.block+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){
    document.getElementById('recent').innerHTML='<div class="error">Could not load settlement data ('+e.message+'). It refreshes automatically; you can also open <a href="${base}/stats">/stats</a>.</div>';
    for(const id of ['s-count','s-volume','s-payers','s-payees'])document.getElementById(id).textContent='n/a';
  }
}
load();setInterval(load,30000);
for(const b of document.querySelectorAll('button.copy'))b.addEventListener('click',async()=>{await navigator.clipboard.writeText(document.getElementById(b.dataset.copy).textContent);b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1500)});
</script>
</body>
</html>`;
}
