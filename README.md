# qoder-magpie

Your [Qoder](https://qoder.com) subscription in OpenCode and
[magpie](https://usemagpie.ai).

This is the `packages/qoder` plugin of
[magpie-community/plugins](https://github.com/magpie-community/plugins),
extracted as a standalone plugin and patched so the device identity is
derived instead of read from an installed Qoder.

| Provider id | Site | Accounts | Plugin export |
|---|---|---|---|
| `qoder` | qoder.com (international) | Google, GitHub or email | `QoderAuthPlugin` |
| `qoder-cn` | qoder.cn (Qoder CN) | Alibaba Cloud or phone number | `QoderCNAuthPlugin` |
| `qwenwork` | gateway.qwenwork.cn (QwenWork) | phone number or email | `QwenWorkAuthPlugin` |
| `qwenwork-enterprise` | the enterprise's own domain | email OTP or enterprise SSO | `QwenWorkEnterpriseAuthPlugin` |

## Install

```
magpie plugin add ./qoder-magpie
```

Then sign in from the provider's row in Plugins, or in a terminal:

```
magpie plugin login qoder
```

## The device identity

Qoder's daily credits (100 a day) are offered per device, not per account.
The campaigns page that lists them answers 200 either way, but the claimable
campaign is filtered out of the list unless the request carries a device
identity: `Cosy-MachineToken` and `Cosy-MachineType`.

The upstream plugin read that identity from Qoder's own `runtime-info`
helper — the file Qoder desktop installs and Qoder CLI caches. It is a
signed native binary, so there was nothing to read on a machine with
neither installed: the check-in answered `ineligible` for the day and said
to install Qoder.

Here the identity is derived from the account's own uid, the way
[qoder2api-hub](https://github.com/shuishuipingan/qoder2api-hub) derives it
([`qoder_fingerprint.py`](https://github.com/shuishuipingan/qoder2api-hub/blob/main/qoder_fingerprint.py),
MIT):

- the machine id is an md5 of `machine:<uid>`, shaped as a dashed UUIDv4, so
  it reads like the machine id the official client takes from the OS
  hardware UUID;
- the machine token and the machine type are derived the same way, in the
  shapes the official client sends.

One account derives the same identity every time and two accounts never
derive the same one, so each account is seen as its own device. Nothing is
read from the machine, so the daily credits no longer need Qoder installed.

The machine the plugin signs in from is a different thing: the device flow
names a machine id before the account is known. That one is made once and
kept in the plugin's directory (`qoder-device.json`), so the same device
signs in again.

Set `QD_DEVICE_ID_LEGACY=1` to keep the older 32-hex shape. A machine id
that changes is a new device to the upstream, so an account whose identity
must not move wants this.

## Sign-in

**Sign in with Qoder** is the sign-in Qoder's desktop client uses:

1. A PKCE device flow opens qoder.com's account page.
2. openapi.qoder.sh is polled every 2 s until you authorize, for at most
   15 minutes.
3. The device token is traded for a job token, and the account's email and
   name are read.

**Sign in with Qoder PAT** skips the device flow: a Personal Access Token
from `<site>/account/integrations` is posted to `/api/v1/jobToken/exchange`
(`personal_token`), which answers a job token, its refresh token and its
expiry. The PAT is kept on the credential, so a lapsed job refresh is
exchanged again instead of asking for the sign-in; PATs last up to a year.

## What is kept

The job token, its refresh token and expiry, the uid, the device token and
the machine id. OpenCode keeps them in `auth.json`; magpie keeps them in
`plugin-auth.json`.

Refreshing:

- Qoder spends a refresh token once, so the plugin never sends one twice.
- magpie renews the job token 10 minutes before it runs out, through the
  plugin's `auth.refresh`; OpenCode doesn't call that hook, so there the job
  token is refreshed 5 minutes before it runs out, before a request.
- A chat Qoder answers 401 or 403 with no other code ("Login expired") is
  sent again once: with the pair saved since, else after one refresh.
- The device token, which reads usage, has no end on record: it is rotated
  when Qoder refuses it.
- When Qoder refuses a refresh (401 or 403), the account needs signing in
  again. Any other failure is tried again later.

## Requests

Qoder serves its models on the API its client talks to:
`api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation`. The
plugin's `fetch` takes the chat completion OpenCode sends and writes it as
Qoder's own request: its own system line first, messages as text and image
blocks, tool calls and results as OpenAI tool turns, and its tools as
Qoder's native function tools. The body goes out in Qoder's own codec,
signed with the COSY envelope.

Tool calls Qoder writes as XML or JSON in its text are lifted out as tool
calls. A call written in Anthropic's or Qwen's tags with no `<tool_call>`
around it is a call too, but only for a tool the request declared.

**Errors**

| What Qoder says | What the request returns |
|---|---|
| A refused sign-in (no code, or code 105) | 401 |
| A quota (codes 110, 112–119, 122) | 429 |
| A refused request itself (codes 406, 416, 430, 80411, 80412, 100400–100403) | 400, with Qoder's words |
| "Error in upstream response", the vendor behind Qoder failing | 502, so magpie asks again or another account |
| Busy or queued for the model (code 10605) | The request waits in Qoder's queue as Qoder's client does, then is sent again; a streamed request is answered 200 at once and kept alive with SSE comments; past the wait, 503 with `Retry-After` |
| A failure before the answer starts | Qoder's status |
| A failure after the answer has started | The stream ends with an error |

## Models

The `provider.models` hook reads the account's own list, as Qoder's client
asks for it (`/algo/api/v2/model/list`). It keeps the enabled models of the
listing's `app` scene and adds any model only the `chat` scene still lists
after the model it follows there. It leaves out "auto" and "default", which
route inside Qoder.

Until you sign in, the `config` hook declares the list as it was on
2026-09-30, with the app's Fast from 2026-10-12:

- Ultimate, Fast, Performance, Efficient
- Sonus, Cantus
- Qwen3.8-Max, Qwen3.8-Flash, Qwen3.7-Max, Qwen3.7-Plus
- Kimi-K3, Kimi-K2.8-Preview
- GLM-5.3, GLM-5.3-Flash
- DeepSeek-V4-Pro, DeepSeek-Flash
- MiniMax-M3

Every model speaks chat completions (`@ai-sdk/openai-compatible`).

## Qoder CN

`qoder-cn` is for accounts on [qoder.cn](https://qoder.cn), the China site.
Those accounts sign in with Alibaba Cloud or a phone number and can't sign
in through `qoder`. Qoder CN speaks the same protocol as qoder.com: the
same device flow, poll, job token and refresh paths, the same COSY
envelope and body codec, the same model list, chat and usage paths. Only the
hosts and the sign-in's client id differ.

| | `qoder` | `qoder-cn` |
|---|---|---|
| Sign-in page | qoder.com | qoder.cn |
| Accounts: poll, tokens, user info, usage | openapi.qoder.sh | openapi.qoder.com.cn |
| Models and chat | api3.qoder.sh | gateway.qoder.com.cn |

### Enterprise VPC

A Qoder CN enterprise on its own VPC instance signs in with **Sign in with
Qoder CN Enterprise (VPC)**. It asks for the instance: its name (`acme`) or
one of its addresses (`acme.vpc.qoder.com.cn`,
`https://acme.vpc.qoder.com.cn`). Only https and hosts under
`vpc.qoder.com.cn` are taken.

| | Public Qoder CN | VPC instance `acme` |
|---|---|---|
| Sign-in page | qoder.cn | acme.vpc.qoder.com.cn |
| Accounts: poll, tokens, user info, usage | openapi.qoder.com.cn | acme-openapi.vpc.qoder.com.cn |
| Models and chat | gateway.qoder.com.cn | acme-gateway.vpc.qoder.com.cn |

The account is named `<email> (<instance>)`, so it is listed apart from the
same person's public account.

### Enterprise dedicated domain (企业版专属域)

An enterprise whose Qoder IDE signs in through 「企业版专属域登录」 with a
domain of its own (any https host) signs in with **Sign in with Qoder CN
Enterprise dedicated domain (企业版专属域)**. It asks for the domain as it
is set in Qoder IDE's settings: a host or an https address (a path is
dropped).

A domain that answers 404 on `GET <domain>/algo/api/v1/version` is a legacy
Lingma 1.0 (通义灵码) dedicated domain: it has no device flow and takes no
console PAT, so the plugin uses the account Qoder CN IDE is already signed
in to on this computer.

### QwenWork (千问办公)

`QwenWork` and `QwenWork 企业版` serve Alibaba's own QwenWork (qwenwork.cn)
on this same protocol. The enterprise flagship (企业旗舰版) serves
web/openapi/api on the enterprise's **own single domain**, and its device
flow sends **no `redirect_uri`**. Its sign-in asks for that domain —
`QWENWORK_ENT_DOMAIN` presets it so the sign-in asks nothing.

There is no PAT and no daily check-in on QwenWork: the `pat: false` and
`checkin: false` site fields turn both off.

## Daily check-in

Qoder gives credits for a daily claim (the Qoder client's campaign
`CLAIM_BENEFIT`, 100 Credits a day as reported), on both sites. magpie can
claim it for each account when its Qoder check-in switch is on (Settings),
through `auth.checkin`: an already claimed campaign is `done`, a campaign
not available is `inactive`, and a claimable one is `claimed` with its
benefit amount.

The check-in carries the derived device identity, so it works on a machine
with no Qoder installed. A list with no daily claim is `inactive`, with a
message saying Qoder offered this account's device identity no daily
credits campaign, that Qoder decides that per device, and that the credits
can be claimed in Qoder desktop when it shows them.

- **List:** `GET <openapi>/sash/api/v1/me/campaigns`: `campaigns[]` with
  `campaignId`, `actionType`, `claimStatus` (`CLAIMABLE`, `CLAIMED`),
  `startAt`, `endAt`, `benefit.amount`.
- **Claim:** `POST <openapi>/sash/api/v1/me/campaigns/{id}/claim`, body
  `{}`: `status` `CLAIMED` (or under `data`).

The daily 100 credits are a campaign of their own each day, listed from
10:00 (UTC+8) to 09:59 the next day. A check-in before 10:00 meets the day
before's campaign: it claims that one if it is still open.

## Free models when the credits run out

Qoder serves its free models after the credits are used up. So the credit
windows the usage hook gives name the account's free models in
`notModels`: a model listed at 0×, from the account's own model list.
magpie then doesn't count those models as spent on a used-up account. A
list that can't be read leaves every model counted.

## Not here

- Qoder's usage and quota display.
- Several accounts at once.
- magpie's web-search stand-in.

## Credits

The protocol (endpoints, COSY envelope, body codec and device flow) comes
from [CLIProxyAPI](https://github.com/ufec/CLIProxyAPI)'s Qoder support, by
way of magpie. Its MIT license is in `LICENSE-CLIProxyAPI`.

The device fingerprint derives from
[qoder2api-hub](https://github.com/shuishuipingan/qoder2api-hub)'s
[`qoder_fingerprint.py`](https://github.com/shuishuipingan/qoder2api-hub/blob/main/qoder_fingerprint.py)
(MIT). That file is the source to consult when this one's derivation
changes: the machine id, the session id, the machine type and the machine
token are derived exactly as it derives them.

## License

MIT
