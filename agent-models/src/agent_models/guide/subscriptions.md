## Subscriptions (vendor catalog, no account state)
Checked 2026-11-04 for OpenCode free privacy and native usage scope; other vendor/plan facts retain their 2026-10-27 review unless separately dated. Read this only when the choice depends on a plan, allowance or retention policy. For strengths and effort advice, use [models](models.md) (`model-guide read models`). Prices are published USD prices; region, billing terms and rollout can differ. **Unverified** means the cited sources do not establish the detail; do not infer entitlement from a model listing.

### Find live account state
- `model-guide policy --backend BACKEND`: complete official policy text, automatically fetched when missing/due on a seven-day cadence. Use it for current plan names, eligibility, shared pools, exceptions and consumption multipliers; the dated catalog below is background, not an access rule. `--refresh` rechecks a material ambiguity. A failed fetch retains last-good text and its original date; it does not verify a claim or authorize credits.
- `codex-auth list --skip-api --json`: native source/update time, refresh status and actual window durations/resets. Plan names never create windows. Mask identities when reporting. Codex `/status` and the vendor usage dashboard remain authoritative for the selected session.
- `cswap list --json`: managed Claude accounts and usage (percent used); `agent-accounts refresh --backend claude` publishes numbered remaining allowance for Wake/Bridge. For account selection and concurrent-session limits, read `~/dotfiles-with-agency/claude/README.md#accounts`. Claude's `/status` remains authoritative for the selected conversation.
- `agent-accounts refresh`: refresh structured native account buckets; `model-guide models --backend agy --account ACCOUNT`: account-specific IDs. Native inventory, pool membership and entitlement differ; missing bindings stay unknown.
- `agent-accounts refresh --backend opencode`: query the existing native service's usage for the current directory. Cached workspace Go meters and scoped Console spend budgets expire freshness after ten minutes; reset windows become unknown. These are not free-tier quotas, credit balances or proof of a selected session's entitlement. The [native API](https://opencode.ai/v2/docs/api#usage) returns unknown/signed-out when it has no applicable workspace information.
- `model-guide models --backend X`: backend inventory, not proof of included usage. Add `--json` for resolved identities, native effort metadata and generated benchmark coverage. Claude initialization resolves aliases without inference; OpenCode's native API lists enabled models/variants for the current directory; agy leaves separate effort ranges unknown. The selected session's status, picker and billing controls establish live access.

### Codex / ChatGPT
The [pricing page](https://learn.chatgpt.com/docs/pricing) lists:

| Tier | Published access and allowance |
|---|---|
| Free ($0) | Luna, Standard speed, desktop app, subject to rollout; numeric allowance Unverified |
| Go ($8/month) | Same documented Luna access; numeric allowance Unverified |
| Plus ($20/month) | CLI, IDE, web and cloud integrations; Sol 6.1 and Luna named |
| Pro ($100/month) | Plus features; no five-hour limit; weekly limits may apply |
| Pro ($200/month) | Same published Pro row |
| Pro ($500/month) | Same row, plus Ultrafast access |
| Business | $20/seat/month annually (2+ seats), $25 monthly; Standard Business estimates match Plus |
| Enterprise / Edu | Flexible pricing uses credits without fixed rate limits; otherwise Plus-like per-seat limits for most features |
| API key | CLI/SDK/IDE, API model access and token billing; no cloud features; API limits apply |

Relative allowances and speed-mode consumption can change without changing a plan's price. Read `model-guide policy --backend codex`, including the official [Pro-tier update](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers) and [pricing/usage](https://learn.chatgpt.com/docs/pricing). Preserve the source's exact conditions and distinguish included allowance from credits and API prices. Native windows, not a price or historical multiplier, establish the observed reset horizon.

Privacy/retention: [Codex security](https://learn.chatgpt.com/docs/security) describes data controls. Business data is not used for training by default ([pricing](https://learn.chatgpt.com/docs/pricing)). **Unverified** here: tier-specific retention durations and consumer training defaults; check the applicable data controls and API terms before sensitive work. API billing is separate from subscription allowances.

### Antigravity / agy
Published allowance classes from [pricing](https://antigravity.google/pricing) and [plans](https://antigravity.google/docs/plans):

| Tier | Published allowance |
|---|---|
| Individual / free ($0) | Basic weekly rate limits; unlimited Tab completions and Command requests |
| Google AI Plus | Included in the model-access table's Free/Plus column; separate allowance/price Unverified here |
| Google AI Pro | Higher quota refreshed every five hours until the weekly limit; flexible AI credit pool; numeric allowance Unverified |
| Google AI Ultra | Highest quota refreshed every five hours and highest weekly limits; flexible AI credit pool; numeric allowance Unverified |
| Business via Google Cloud | Consumption-priced API; eligible Gemini Enterprise Standard/Plus from $30/seat/month, or pay-as-you-go with $0 seat fee |

[Model availability](https://antigravity.google/docs/models), trial/device conditions and retirement dates are in `model-guide policy --backend agy`; they are not inferred from a quota group or subscription price. Native listing and rollout can differ. GPT-OSS remains excluded by Bridge policy, independently of native support.

Privacy/retention: individual access uses terms derived from Google Terms of Service; Business uses Google Cloud terms ([plans](https://antigravity.google/docs/plans)). **Unverified**: training defaults and retention durations for each tier. Do not treat unlimited completions as unlimited agent-model usage; inspect the live Gemini and Claude/GPT buckets.

### OpenCode
OpenCode can also use external providers; their billing and data terms are separate.

**Preserve the full requested provider/model/variant.** Free variants and included
subscription allowances are different billing routes for every model family.
For example, `opencode/deepseek-v4.1-flash-free` is a free variant;
`opencode-go/deepseek-v4.1-flash` uses Go's separate allowance. The same distinction
applies to GLM, MiniMax and other model variants. A configured credential or a
failed service/API probe is not a reason to substitute a provider, model or billing route.

- **OpenCode free**: the bridge permits only `opencode/glm-5.3-flash-free`, `opencode/deepseek-v4.1-flash-free` (the code's fixed ZDR allowlist). [Current model docs](https://opencode.ai/v2/docs/console/models/#free-models), checked 2026-11-04, confirm zero retention and no training for those routes. MiniMax's free endpoint is absent; its privacy remains **Unverified**, so it is not admitted by that gate. Other free models have distinct data terms; Beam retains 30 days without training. No numeric free allowance is published there; availability is temporary. **Unverified**: IP-based limits/no-login access.
- **Zen / Console pay-as-you-go**: buy credits, pay per request; no subscription allowance. Models include OpenAI, Claude, Gemini and open families. [Model/privacy docs](https://opencode.ai/docs/zen) list retention exceptions; zero retention is not universal. Check the endpoint's privacy row before use.
- **Go ($10/month)** and **Go Plus ($40/month)**: [Go docs](https://opencode.ai/docs/go) list GLM, Kimi, DeepSeek, Qwen, MiniMax, Luna, Haiku, Argon and others. Each model has a monthly dollar allowance: five-hour window 20%, weekly 50%, monthly 100%. Example GLM-5.3: $15/month Go, $120 Go Plus. These are usage allowances, not account balances.

[Go privacy table](https://opencode.ai/docs/go#privacy) applies to both Go tiers: Luna, Haiku 5.5, Grok and Beam retain 30 days without training; Argon, GLM, Kimi and MiniMax have zero retention/no training. Muse Spark Contributor models train on requests and are not ZDR. DeepSeek's zero-retention agreement renews monthly; re-check its expiry before use. Workspace privacy settings can block training endpoints and regions. A subscription does not override endpoint retention.

Native usage scope checked 2026-11-04: Go's API meters describe the workspace's rolling, weekly and monthly usage. Do not turn the model-price/allowance table into independent remaining buckets for each model. The API's Console budgets retain their member/shared, set/per-model and coverage scope; a spend ceiling is not purchased credit or included Go allowance. DeepSeek's currently published ZDR agreement expires November 30, 2026; recheck that exact term after expiry.

### Claude / Claude Code
Read `model-guide policy --backend claude` for [usage-window exceptions](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work) and [Fable plan conditions](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan). Full source text retains verification, plan/seat and credit conditions; there is no universal five-hour or Fable-included rule. Historical plan names below do not imply equivalent current limits. Included usage, separately paid credits, organization restrictions and exhausted quota differ; native picker/billing controls establish selected-session access.
Absolute message counts and every model/contract exception remain **Unverified** unless the applicable current source or native observation establishes them.

| Tier | Allowance/access |
|---|---|
| Free | Claude Code subscription access Unverified in the cited Pro/Max article |
| Pro | Claude Code included; bound jobs when the allowance is thin |
| Max 5x | Higher capacity option named by support; exact absolute allowance Unverified |
| Max 20x | Higher capacity option named by support; exact absolute allowance Unverified |
| Team | Code included in all seats; Premium seats provide more usage; model list, prices and absolute allowances Unverified here ([organization guide](https://support.claude.com/en/articles/11845131)) |
| Enterprise | Code included in new/self-serve seats; older plans require Chat + Code or Premium seats; prices/model lists/absolute allowances Unverified here ([organization guide](https://support.claude.com/en/articles/11845131)) |
| API | Separate Console credits, API rates and limits; a key can select API billing instead of subscription usage |

Privacy for Pro/Max: training depends on the consumer setting and safety exceptions ([data usage](https://code.claude.com/docs/en/data-usage)); Code retains data 30 days without model-improvement consent, five years with consent. Deleted chats are removed from backend storage within 30 days ([consumer retention](https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data)). Team, Enterprise and API have standard 30-day retention; qualified Enterprise organizations can enable ZDR, which is not a standard entitlement ([commercial data usage](https://code.claude.com/docs/en/data-usage)). **Unverified** here: exceptions for every model/contract; check applicable terms before assuming ZDR.
