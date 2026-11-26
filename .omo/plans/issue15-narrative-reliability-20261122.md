# issue15-narrative-reliability-20261122 - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**Who this is for and what changes for them:** 一鍵彙整操作者。說明文改用適合文章的輸出方式；尾端失敗仍能取得已有效完成的部分草稿，舊摘要不被覆蓋。

**What you'll get:** 共用而不放寬的原生回應驗證、文章專用輸入與狀態、完整與部分成果明確分流，以及能查驗的回歸與執行收據。

**Why this approach:** 真失敗發生在最後文章重複至截斷，前三項已有效。移除文章不需要的整篇JSON編碼責任，並隔離尾端失敗；不再改動穩定的證據與三項規則。

**What it will NOT do:** 不接受截斷、不自動重試或補寫、不把部分草稿當完整保存；不執行新付費實驗、遠端寫入或部署，也不保證尚未真人驗證的模型成功率。

**Effort:** Large
<!-- Effort is exactly ONE band, never hours/days. Quick = single edit, minutes of agent work; Short = one focused change, a few files; Medium = multi-file feature in one session; Large = several waves, one long session; XL = multi-session or architectural work. A written duration is rewritten to a band. -->
**Risk:** Medium - 尾端失敗與成果狀態的交界，需保留來源與帳務守門。
**Decisions to sanity-check:** 使用者已選尾端失敗提供部分草稿；完整新摘要仍須有效說明文。

Your next move: 審閱本計畫，通過後依本輪既有指令施工。Full execution detail follows below.

---

> TL;DR (machine): Large / Medium；native Markdown、共用封套、late-partial、版本/帳務/真QA，5 implementation rows +4 final audit rows（同一gate）。

## Scope
### Affected user and ideal state
<!-- From the draft ledger: who this touches and how they use the result, then one IS row per property with its reason, then one GAP row per difference with its reason. Every todo below closes a GAP row; ## Success criteria proves every IS row. -->
**Affected user:** DEV一鍵彙整的操作者與維護者。這次真失敗在尾端說明文；前三項與必要補完已有效，不再錯修抽取或三分項。

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | 說明文以native Markdown交付，host序列化同層data.introduction；保留歸屬、條件與少數觀點 | 自由文章不需模型escape整篇JSON string |
| IS-2 | 所有JSON與Markdown共用唯一嚴格native封套驗證，length/refusal/tools仍拒收 | 不能用接受截斷或修補換取假成功 |
| IS-3 | 真正成功時三分項/citation_map不動；只有intro尾端失敗時交可查看partial草稿，保留帳務、舊summary不覆蓋 | 使用者已明確選「尾端失敗時: 提供部分草稿」 |
| IS-4 | 模型知道各分項是completed/no_findings/failed/not_started，不從翻譯過的狀態文字推論素材結論 | no_findings與failed不同，不能編造共識缺席 |
| IS-5 | 版本/參數/輸出policy/限制/真request都在既有指紋，舊工作不續跑新協定；付費不重試 | 不繞過來源、權限、unknown或ledger |
| IS-6 | 有真案例重播、實際module/Workflow驗收與明確下一人工品質點 | 不把synthetic漂亮文章當Gemma成功率 |
| GAP-1 | 目前將自由文章放單欄JSON schema，真回應重複1361次直到8192tokens/length | 新輸出責任與明確文章brief，不能證grammar必為成因 |
| GAP-2 | native封套與JSON解析在generation.ts混在一起，intro耦合JSON request型別 | 抽共享native邊界、保留JSON其餘呼叫強型別 |
| GAP-3 | intro輸入沒有機器可讀分項狀態；parameters hash僅structured fixtures | 清楚狀態與完整指紋，防舊配置及錯誤推論 |
| GAP-4 | 原happy替身只回JSON intro，無native Markdown接線與真case對照 | 更新同owner，依真surface驗而非pin提示字句 |

### Must have
1. 既有八路徑短ID增量保留，starting-tree.json的15hash全吻合；由本輪ultrawork指示可獨立本地commit，沒有push。
2. `nativeCompletion.ts`提供`parseNativeContent(value:unknown):string`、`parseNativeJson(value:unknown):unknown`與typed native錯誤。原gen parseNativeJson兼容re-export。移動而非複製原封套檢查/單一完整json fence例外；不改原錯誤碼。
3. `introduction.ts`獨立`IntroductionRequest`，builder改單參數`{issue,data,language,section_status:Readonly<SectionStates>}`；沿用allowlist、48KiB、同Gemma/8192/.2/非thinking/非stream，明確response_format `{type:'text'}`。其他structured request型別不放寬。
4. `parseIntroduction`直接接收native回應，經共享content validator，只驗非空、trim外部空白，保留內部Markdown。標題/2–6短段/融合理解屬brief，不加嚴苛風格regex、重複詞分數或段數配額。依此降低不必要格式失敗；語義正確仍AI-unverified。
5. runner在prepare-introduction傳真的section statuses，保存新專用request，validate直接parseIntroduction(raw.response)。必要成功intro、舊summary不覆蓋及failure/unknown/replay/source契約不改。
6. 新intro prompt v3、output/schema version v2-native-markdown、output policy與request limit都入pipelineSettings；parameters hash含intro request並保留既有structured fixtures。v18三項/補完版本、提示與參數不改。
7. 明確文件：本輪沒新Gemma，transport改善是候選設計，不宣稱已解所有退化；下一人工點正常一鍵彙整確認完整文章品質。
8. 新partial僅在必要補完有效且`completion_result`可用後，intro的context limit/付費預算/provider或native內容失敗，仍走同一assemble步驟，以完成base原資料為draft、`partial=true`、introduction診斷failed與真reason/raw refs；沒有intro占位或假結果。保留當次三分項原狀（若原本upstream已partial仍partial）。prepare/generate/validate失敗不再先終止execution；source/account/config/erase失敗走原安全路徑、不得交data；mandatory completion失敗也不能進這個分支。原metadata/引用/source驗證先有效，完整ai_draft仍必有成功intro。
9. API/既有client沿用partial_draft/partial呈現與DEV onPartial草稿通道，不創新partial_data欄位。主以實際browser驗既有元件會顯示partial/未保存、可取data、舊summary仍在、0自動POST；無樣式重畫或新增公開介面。若現行文案未能準確表達intro晚期失敗，僅補三語該狀態文字。
### Must NOT have (guardrails, anti-slop, scope boundaries)
無partial_data新欄位、無缺intro的full summary發布、無部分成果繞來源/帳戶守門。無模型替換、新呼叫、重試/repair/fallback、懲罰/seed/stop/溫度或token調參。無新依賴/DB表/migration/來源寫入/queued重啟/live model/dev:remote/push/deploy。私有正文、raw、job識別資料不進計畫或git；本計畫只記匿名case指標，原SQL/工件留private root。不得大改穩定P1/E1/Clef或三項候選/引用/互斥、樣式或公開UI；僅驗既有partial路徑及必要準確提示。

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: 先真case before（已PASS原拒收），既有owner紅→綠/實際mutation接線證明，vite-plus/test；不增加prompt文字測試或重複native矩陣。
- Private evidence A=/Users/bestian/.omo/agent/sessions/--Users-bestian-Documents-GitHub-civic-talk-hono--/artifacts/issue15-system-plan-20261122。NOTE=/var/folders/td/kr4htlwn60d9dzz6_87l3gp80000gq/T/ulw-20261122-150405.XXXXXX.md.5iPkI0aWIK。
- 命令一律用本輪RUN_TMP三env/npm vp。公共模型sync-input/output schema已保存A/official-*-schema.json，明示text + native choices/model；Context7不可用，沒有憑猜新增SDK參數。
- 最終執行 `npm exec -- vp check --no-fmt --no-lint`、`npm exec -- vp test`、`npm run build`；LSPclean/sourcehash綁定。既有887測試保留，新增只限缺口；品質與原始raw不進公開fixtures。
- 真surface為data/API library：主執行`bun A/qa-introduction.ts`，正式builder/native parser用保存的真issue+完成JSON，原length raw必仍拒收，另明示synthetic native Markdown happy與對抗封套。正式Hono/SQLite Workflow owner驗真正writer/summary/revision/帳務。主另用owned browser+實際partial元件/控制器驗收；僅以本機網路stub回傳synthetic private API資料，不用真人登入/有效遠端GET，不按真正付費按鈕。精確fixture URL/action待確認元件後先記NOTE再執行。browser action log/screenshots/cleanup留A，不以DOM副本假驗。

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.
本輪是一個內聚的native協定改善，不為湊數切碎：Wave1保存既有已驗基底；Wave2一個disjoint模組子單元與主接線/文件平行；Wave3整合驗收與一次gate。主自己負責source閱讀、真QA/整合、版本/runner/testPipeline；deep-low子單元只寫nativeCompletion/introduction/testIntroduction。共同檔案不交叉。architect不可用，已由主作整體設計；ultrabrain advisory已完成並獨立核實，不再spawn多餘planner。

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | reviewed plan | 2,3 | none |
| 2 | 1 | 3整合 | 3接線編輯 |
| 3 | 1,2接口定義 | 4 | 2模組編輯 |
| 4 | 2,3 | F1–F4 | none |
| 5 | F1–F4 | final | none |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [ ] 1. 保存已驗短ID基底並核對提交界線
  Recommended task executor category: quick（主執行，git-master；既有hash檢查及atomic checkpoint）。
  Closes: GAP-2/4的基底隔離；Wave1，無平行。
  References: A/starting-tree.json、前輪issue15-followup-20261122/validation-input.json與gate-review.md；HEAD ec09e88。
  What: 核15hash、實際8dirty path與staged空；只stage這8路徑，不包含新plan或他人檔。讀git log --oneline -20及git log -5 --八路徑。只一筆既有已驗codec commit。
  Acceptance/QA: `git diff --cached --check` exit0；staged paths精確等8；commit後git show核scope，clean HEAD `npm run build` exit0/metadata同SHA（原15hash與前輪184/887/checks相同時沿用已證suite，不假稱重跑）。
  Failure: 任何hash/foreign diff不同停commit、查清scope，不reset。Evidence A/base-commit*.log、starting-tree.json。
  Commit: Y | fix: 精簡彙整模型引用並保留完整來源映射

- [ ] 2. 實作共用native邊界與獨立Markdown說明契約
  Recommended task executor category: deep-low（disjoint 3檔，契約已定）。
  Closes: GAP-1/2/4；Wave2，依1，平行3的主檔接線。
  References: src/ai/generation.ts:1103–1135、429–440；src/ai/introduction.ts全文；src/tests/evidenceIntroduction.test.ts全文；原gen native表保留。
  What: 新nativeCompletion.ts移完整封套+JSON parser，不改原碼/JSON fence；introduction builder單context參數、readonly型別及真section_status allowlist，text response_format，公開body非空Markdowntrim-only；新prompt/output policy版本如Must have。不要修改generation.ts/runner/pipeline test（主負責）。
  Acceptance/QA: `npm exec -- vp test src/tests/evidenceIntroduction.test.ts` 綠；3語言投影/48KiB完整邊界/CRLF Unicode保留、native length/refusal/reasoning不能代替content。schema舊體改為native輸入，不dup整個gen native矩陣。
  Failure: whitespace final body/native length必拒、原raw不改。Evidence A/intro-focused.log、子工作source/diff/cleanup收據；主整合前讀全部3檔。
  Commit: N，與3/4為同一不可分割協定提交。

- [ ] 3. 接上Workflow與完整版本費用指紋
  Recommended task executor category: deep-low（主負責跨呼叫接線，不另派同檔）。
  Closes: GAP-2/3/4；Wave2，依1，2完成前不跑整合測試。
  References: runner.ts:84,740–809；generation.ts:24,429–440,1103–1135,1570–1594；tests/evidencePipeline.test.ts:163–196,3346–3438,2790–2831。
  What: gen import/re-export共享parseNativeJson、刪舊實作；runner的IntroductionPlanArtifact/request用新IntroductionRequest，從outcomes明確組SectionStates且缺項not_started，parseIntroduction直接收raw native。intro failure ref攜status/reason/validationcode/ids（checkpoint不放正文）；prepare/generate/validate任一失敗均由已驗completion base走同一final assemble partial分支，不呼叫全域finishFailure，source/account/erase/config仍原安全終止。完整summary必要intro契約不動。pipelineSettings intro真request/status/outputPolicy/max request bytes納入config，parameters hash亦含intro真input；真failure policy也入config以隔離舊manifest。無新paid step或重試。
  Acceptance/QA: `npm exec -- vp test src/tests/evidenceGeneration.test.ts src/tests/evidenceIntroduction.test.ts src/tests/evidencePipeline.test.ts`；更新synthetic provider先辨intro text，其他JSON schema仍嚴格。完整happy保存+人改保intro；截斷/空/provider/unknown/budget/erase/replay/current config三項原owner維持。
  Failure: native length即使content看似完整也不能當intro成功；但三項有效時交partial draft，private native仍完整留、old summary不變、未知預留不釋放；無有效completion/source不交partial。新policy舊manifest在付費前拒configuration_changed。原budget intro barrier改驗partial/no new attempt、erase仍erased/no data；之前mandatory completion的失敗行為不變。
  Evidence A/focused*.log、version-qa.json。Commit N，與2/4同一increment。

- [ ] 4. 主代理真case與整合驗收並同步契約文件
  Recommended task executor category: deep-low（主自己跑真surface及own變更檢查）。
  Closes: GAP-1–4；Wave3，依2/3。
  References: A/generation.json、replay-before.json、official schema；docs/evidence-api-review.md及src/AGENTS.md原tail規則；現有Hono/SQLite Workflow owner。
  What: docs說明nativeMarkdown/分項status/同一native嚴格邊界/同profile/失敗保存原契約。主建立私有qa-introduction.ts（不進git），關網路；取得原saved issue+完成JSON及original native raw，呼叫正式builder/parser。
  QA happy: `bun A/qa-introduction.ts`，新payload真source public fields/status、native content中中文/CRLF/Unicode/內部Markdown逐字保留；合成native語義好壞不作Gemma證據。對照現有完成三項與citation map hash不動。
  QA failure: 同CLI原raw回generation_incomplete_completion且hash不動；length with plausible content、refusal/tool/final空+reasoning好文章仍拒；counterfactual重複但stop且非空可過delivery（明示語義未驗，不能加regex假解）。
  Regression: 真Hono/SQLite owner測成功writer與intro partial writer，事先保存舊summary再尾端失敗須不覆蓋；partial三項/citation_map對照completion base逐值相同、intro缺欄而非占位、一次paid/unknown/replay守住。接線mutation恢復intro失敗舊early finishFailure，partial owner必紅；native length guard另沿既有owner驗，不複製矩陣，立刻restore。
  Browser: 讀browser技能，owned profile在 `http://127.0.0.1:5199/qa?language=zh-TW`（另en/ja）掛實際src/components/EvidenceSummary.vue（props issueId15/active true/canSummarize true/banned false/sessionExpired false），provideI18n選語言；本機Vite無CF plugin，network stub回summary version2/has_summary true/舊summary與partial job及三項data。`page.goto`後 `[data-testid="evidence-summary-status"]` 必含該語vol_ai_partial，console標記有3項無intro，HTTP記錄只有GET/no POST；既有Hono owner另證舊summary值不變，不用fake DOM宣稱舊summary可見。桌1440x1000/手機390x844、三語/淺深截圖檢視無overflow；完整action log、12shots與cleanup receipt，沒有真人cookie或paid按鈕。
  Acceptance: LSP/完整check/test/build綠、source hash綁定，無private body進repo。Evidence A/qa-introduction.json/log、final-*.log、validation-input.json、mutation.log。
  Commit: Y（F1–F4核可後） | fix: 分離議題說明的原生 Markdown 輸出契約

- [ ] 5. 清理資源與交付真人品質檢查點
  Recommended task executor category: quick（主執行已知資源清理與commit收據）。
  Closes: GAP-4；依F1–F4通過。
  References: NOTE resources、A/source hash/QA/gate/commit receipts。
  Acceptance/QA: 移除owned replay-before.ts/qa-introduction.ts/browser fixture入口及RUN_TMP/cache，關owned browser/server，確認port/PID已結束並readback清理收據；private原raw/sql/usage留、耐久NOTE/draft/plan留。不改使用者runtime。
  Failure: 有running child/owned resource就不結案。A/cleanup.json，atomic commit新HEAD後clean metadata build一次，不push/deploy。
  Commit: N（plan狀態/receipt不混入產品；提交若保留Plan footer可明示local plan）。

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
  主audit每IS與sourcehash/實際收據；交唯一omo-native-gate-reviewer核對。
- [ ] F2. Code quality review
  主讀完整diff/new files，programming/junk bar、LSP；同一gate涵蓋，不開panel。
- [ ] F3. Real manual QA
  主執行task4 CLI/browser，完整Hono/SQLite owner作生命週期writer佐證；0live model/remote writes。
- [ ] F4. Ideal-state fidelity
  同唯一gate核每IS對照；真正語義品質明列下一人工點，不能當已通過。ultrawork本輪明確要求plan後施工，這是工程handoff，不另造routine批准。

## Commit strategy
1先獨立8檔已驗基底；2–4單一可建置native協定increment，驗證/唯一gate後commit。本輪明示ultrawork commits指令有效，無push/deploy。每筆前讀現行20條/所改paths5條歷史，精確staged scope/diffcheck，繁中Conventional Commits；native提交footer `Plan: .omo/plans/issue15-narrative-reliability-20261122.md`。不force、不amend、不stage private receipts/他人檔，.omo計畫可保留local，不假稱已發布來源。
規劃審閱例外：此長session先前已invoke ulw-execute，工具明確拒絕plan-consultant（no child spawned）並允許direct/other agent，故不重試或冒充native plan-reviewer。主自查gap後以一般omo-native-gate-reviewer作獨立計畫審閱；報告與hash明確標記替代，不稱原生plan-reviewer receipt。產品施工後仍只有一次獨立終審，沒有panel。

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 2/3/4 | 三語真資料nativeMarkdown往返、host最後序列化 | A/qa-introduction.json及pipeline happy owner |
| IS-2 | 2/3/4 | 原length raw仍拒、共享native原矩陣/接線mutation | A/replay-before.json、qa-introduction.json、mutation.log |
| IS-3 | 3/4 | intro partial fault表+preexisting summary+replay人改/browser既有partial呈現 | A/final-tests.log、browser-qa.json、pipeline owner |
| IS-4 | 2/3/4 | section_status來自outcomes且model payload只allowlist | A/qa-introduction.json及intro/pipeline owner |
| IS-5 | 3/4 | config/params含真text/requestLimit/policy；oldManifest付費前拒、source/unknown/budget原owner | A/version-qa.json、final-tests.log |
| IS-6 | 4/5/F1–F4 | 原case/SUT QA/fullchecks/gate/clean/2commits明確品質限制 | A/gate-review.md、validation-input.json、cleanup.json、commit*.log |
