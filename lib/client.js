window.__ModuleLoader__.load({
	id: "dsh-api-proxy",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const h = react.createElement;

		/* =================================================================== *
		 * 样式
		 * =================================================================== */

		const CSS = [
			".dap-col{flex-direction:column;align-items:stretch;gap:14px;display:flex}",
			".dap-row{align-items:center;gap:8px;display:flex;flex-wrap:wrap}",
			".dap-sec{border:.5px solid var(--dsw-alias-border-l2);border-radius:16px;flex-direction:column;gap:12px;padding:14px 16px;display:flex}",
			".dap-sec-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px;margin:0}",
			".dap-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}",
			".dap-help{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
			".dap-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere}",
			".dap-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px}",
			".dap-input{background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;width:100%;color:var(--dsw-alias-label-primary);box-sizing:border-box;padding:8px 12px;font-size:13px;line-height:20px;font-family:inherit}",
			".dap-input::placeholder{color:var(--dsw-alias-label-caption)}",
			".dap-input:focus{border-color:var(--dsw-alias-brand-primary);outline:none}",
			".dap-input:disabled{opacity:.6;cursor:default}",
			".dap-textarea{min-height:64px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:18px}",
			".dap-btn{background:var(--dsw-alias-button-primary-fill);border:none;border-radius:10px;color:var(--dsw-alias-label-primary-foreground);cursor:pointer;padding:7px 16px;font-size:13px;line-height:20px;font-family:inherit}",
			".dap-btn:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}",
			".dap-btn:disabled{opacity:.5;cursor:default}",
			".dap-btn-quiet{background:transparent;border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}",
			".dap-btn-quiet:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
			".dap-btn-danger{background:transparent;border:.5px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}",
			".dap-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
			".dap-badge{border-radius:999px;padding:1px 8px;font-size:11px;line-height:16px;white-space:nowrap}",
			".dap-badge-on{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}",
			".dap-badge-off{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label)}",
			".dap-badge-idle{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary)}",
			".dap-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}",
			".dap-list{background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;max-height:300px;min-height:0;overflow-y:auto;padding:4px;display:block}",
			".dap-node{box-sizing:border-box;align-items:center;gap:8px;background:transparent;border:none;border-radius:7px;color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;text-align:left;width:100%;padding:5px 8px;font-size:12px;line-height:20px;font-family:inherit}",
			".dap-node:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dap-node-on{background:var(--dsw-alias-interactive-bg-selected,var(--dsw-alias-interactive-bg-hover))}",
			".dap-node-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dap-node-on .dap-node-name{color:var(--dsw-alias-brand-text);font-weight:600}",
			".dap-dot{flex:none;height:8px;width:8px;border-radius:999px;background:var(--dsw-alias-border-l3)}",
			".dap-dot-on{background:var(--dsw-alias-brand-primary)}",
			".dap-delay{flex:none;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;text-align:right;min-width:56px}",
			".dap-delay-good{color:var(--dsw-alias-state-success-primary)}",
			".dap-delay-mid{color:var(--dsw-alias-state-warn-label)}",
			".dap-delay-bad{color:var(--dsw-alias-state-error-primary)}",
			".dap-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;display:flex;gap:12px;flex-wrap:wrap}",
			".dap-kv{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:12px;line-height:18px}",
			".dap-kv dt{color:var(--dsw-alias-label-tertiary)}",
			".dap-kv dd{color:var(--dsw-alias-label-secondary);margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}",
			".dap-bar{background:var(--dsw-alias-bg-layer-2);border-radius:999px;height:6px;overflow:hidden;width:100%}",
			".dap-bar-fill{background:var(--dsw-alias-brand-primary);height:100%}",
		].join("");

		const CSS_TAG_ID = "dsh-api-proxy/api-proxy.css";
		if (
			typeof document !== "undefined" &&
			document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG_ID) + "]") === null
		) {
			const tag = document.createElement("style");
			tag.setAttribute("data-plugin-css", CSS_TAG_ID);
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		/* =================================================================== *
		 * 常量
		 * =================================================================== */

		const STATUS_ROUTE = "/dsh-api-proxy/status";
		const ACTION_ROUTE = "/dsh-api-proxy/action";
		const CONFIG_ENTRY_ID = "dsh-api-proxy";
		const SETTINGS_NS = "api-proxy";

		const DEFAULTS = {
			enabled: false,
			subscriptionUrl: "",
			// 默认空：本插件不预设任何服务商。留空 = MATCH,DIRECT = 什么都不代理。
			apiDomains: "",
			targetGroup: "",
			targetNode: "",
			testUrl: "https://www.gstatic.com/generate_204",
		};

		/* =================================================================== *
		 * 设置作用域（两代 DSH）
		 * =================================================================== */

		/**
		 * 把设置文档里的一段规范成完整设置。
		 * @param raw 原始段。
		 * @returns 完整设置对象。
		 */
		function decodeSection(raw) {
			if (raw === null || typeof raw !== "object") return undefined;
			const value = Object.assign({}, DEFAULTS);
			for (const key of Object.keys(DEFAULTS)) {
				const candidate = raw[key];
				if (candidate === undefined || candidate === null) continue;
				value[key] = typeof DEFAULTS[key] === "boolean" ? candidate === true : String(candidate);
			}
			return value;
		}

		/**
		 * 把 0.2 的 configForms 表单适配成 0.1.5 的「绑定作用域」契约。
		 *
		 * 快照必须是稳定引用：界面用 useSyncExternalStore 读它，React 要求
		 * 「没变化时 getSnapshot() 返回同一个对象」，否则会无限重渲染。
		 * @param form configForms.get(entryId)。
		 * @returns 与旧作用域同形的读写面。
		 */
		function adaptConfigForm(form) {
			if (form === undefined || form === null) return undefined;
			let cached = null;
			let cachedFrom = null;
			return {
				subscribe: (listener) => form.subscribe(listener),
				getSnapshot() {
					const snapshot = form.getSnapshot();
					if (cached !== null && snapshot === cachedFrom) return cached;
					cachedFrom = snapshot;
					cached = Object.assign({}, snapshot, { value: decodeSection(snapshot.value) });
					return cached;
				},
				set: (field, value) => form.set(field, value),
				unset: (field) => form.unset(field),
			};
		}

		/**
		 * 两代设置服务都缺席时的兜底：界面照常出现，值只留在内存里。
		 * @returns 与真实作用域同形的读写面。
		 */
		function createLocalScope() {
			let snapshot = { status: "ready", value: decodeSection({}), writable: true, mode: "local" };
			const listeners = new Set();
			const publish = (value) => {
				snapshot = Object.assign({}, snapshot, { value });
				for (const listener of [...listeners]) listener();
			};
			return {
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				getSnapshot: () => snapshot,
				set(field, next) {
					publish(Object.assign({}, snapshot.value, { [field]: next }));
					return Promise.resolve(true);
				},
				unset(field) {
					publish(Object.assign({}, snapshot.value, { [field]: DEFAULTS[field] }));
					return Promise.resolve(true);
				},
			};
		}

		/**
		 * 订阅设置快照。
		 *
		 * `scope` 是 `SettingsScopeController` 的**类实例**，`subscribe` 与
		 * `getSnapshot` 都是原型方法。裸传（`useSyncExternalStore(scope.subscribe, …)`）
		 * 会丢掉 `this`，React 一调用就抛 TypeError，整块设置页渲染不出来、
		 * 只剩导航项 —— 真机上就是这个症状。所以必须用箭头函数包一层，
		 * 并用 `useCallback` 固定身份，否则每次渲染都会退订重订。
		 * @param scope 绑定作用域。
		 * @returns 实时快照。
		 */
		function useScopeSnapshot(scope) {
			const subscribe = react.useCallback((listener) => scope.subscribe(listener), [scope]);
			const getSnapshot = react.useCallback(() => scope.getSnapshot(), [scope]);
			return react.useSyncExternalStore(subscribe, getSnapshot);
		}

		/**
		 * 渲染兜底：组件抛异常时把错误画出来，而不是留一块空白。
		 *
		 * 没有这道边界，任何渲染期异常都只表现为「设置页什么都没有」，
		 * 排查得去浏览器控制台里捞。
		 */
		class SectionBoundary extends react.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}

			static getDerivedStateFromError(error) {
				return { error };
			}

			render() {
				const error = this.state.error;
				if (error === null) return this.props.children;
				return h(
					"div",
					{ className: "dap-col" },
					h(
						"div",
						{ className: "dap-sec" },
						h("h3", { className: "dap-sec-title" }, "API 代理：渲染出错"),
						h("div", { className: "dap-error" }, String((error && error.message) || error)),
						h(
							"pre",
							{
								className: "dap-mono",
								style: { whiteSpace: "pre-wrap", margin: 0, color: "var(--dsw-alias-label-tertiary)" },
							},
							String((error && error.stack) || ""),
						),
					),
				);
			}
		}

		/** 两代设置服务都缺席时的兜底作用域，供插槽入口复用。 */
		const FALLBACK_SCOPE = createLocalScope();

		/**
		 * 插槽入口：兜住 scope 缺席与渲染异常。
		 * @param props 插槽属性。
		 */
		function ApiProxySectionEntry(props) {
			const scope = props.scope !== undefined && props.scope !== null ? props.scope : FALLBACK_SCOPE;
			return h(SectionBoundary, null, h(ApiProxySettingsSection, { scope }));
		}

		/* =================================================================== *
		 * 小工具
		 * =================================================================== */

		/** 调一次宿主动作路由。 */
		async function callAction(payload) {
			const response = await fetch(ACTION_ROUTE, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			const text = await response.text();
			let parsed = null;
			try {
				parsed = JSON.parse(text);
			} catch {
				parsed = null;
			}
			if (parsed === null) throw new Error(`宿主返回了非 JSON 响应（HTTP ${response.status}）`);
			return parsed;
		}

		/** 拉一次状态。 */
		async function fetchStatus() {
			const response = await fetch(STATUS_ROUTE);
			if (!response.ok) throw new Error(`状态接口 HTTP ${response.status}`);
			return await response.json();
		}

		/** 人类可读的字节数。 */
		function formatBytes(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return "—";
			const units = ["B", "KB", "MB", "GB", "TB"];
			let size = value;
			let unit = 0;
			while (size >= 1024 && unit < units.length - 1) {
				size /= 1024;
				unit += 1;
			}
			return `${size.toFixed(size >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
		}

		/** unix 秒 → 本地日期。 */
		function formatExpire(seconds) {
			if (typeof seconds !== "number" || seconds <= 0) return "—";
			const date = new Date(seconds * 1000);
			if (Number.isNaN(date.getTime())) return "—";
			return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
				date.getDate(),
			).padStart(2, "0")}`;
		}

		/** 延迟对应的颜色档。 */
		function delayClass(delay) {
			if (typeof delay !== "number" || delay <= 0) return "dap-delay";
			if (delay < 200) return "dap-delay dap-delay-good";
			if (delay < 600) return "dap-delay dap-delay-mid";
			return "dap-delay dap-delay-bad";
		}

		/** 延迟文本。 */
		function delayText(delay) {
			if (delay === undefined) return "未测";
			if (typeof delay !== "number" || delay <= 0) return "超时";
			return `${delay} ms`;
		}

		/* =================================================================== *
		 * 设置页
		 * =================================================================== */

		/**
		 * 设置 → API 代理。
		 * @param props 由插槽注入的 `{ scope }`。
		 */
		function ApiProxySettingsSection(props) {
			const scope = props.scope;
			const snapshot = useScopeSnapshot(scope);
			const config = snapshot.value !== undefined ? snapshot.value : DEFAULTS;

			const [status, setStatus] = react.useState(null);
			const [statusError, setStatusError] = react.useState("");
			const [busy, setBusy] = react.useState("");
			const [notice, setNotice] = react.useState({ kind: "", text: "" });
			const [delays, setDelays] = react.useState({});
			const [selection, setSelection] = react.useState({});
			const [draftUrl, setDraftUrl] = react.useState(null);
			const [draftDomains, setDraftDomains] = react.useState(null);
			const [draftTestUrl, setDraftTestUrl] = react.useState(null);

			/** 拉状态；失败不清空旧数据，只在顶上挂一条错误。 */
			const recheck = react.useCallback(async () => {
				try {
					const payload = await fetchStatus();
					setStatus(payload);
					setStatusError("");
				} catch (error) {
					setStatusError(error instanceof Error ? error.message : String(error));
				}
			}, []);

			react.useEffect(() => {
				void recheck();
				// 核心起停是异步的，前几秒多拉几次。
				const fast = setInterval(() => void recheck(), 2500);
				const slow = setTimeout(() => clearInterval(fast), 15000);
				return () => {
					clearInterval(fast);
					clearTimeout(slow);
				};
			}, [recheck]);

			/** 订阅里分组当前选中的节点，进入时同步一次。 */
			const pullSelection = react.useCallback(async () => {
				try {
					const payload = await callAction({ action: "active" });
					if (payload.ok && payload.selection !== undefined) setSelection(payload.selection);
				} catch {
					// 核心没起来时静默失败。
				}
			}, []);

			react.useEffect(() => {
				if (status !== null && status.core !== undefined && status.core.state === "running") {
					void pullSelection();
				}
			}, [status !== null && status.core !== undefined ? status.core.state : "none", pullSelection]);

			/** 跑一次动作，把结果同步进界面。 */
			const run = react.useCallback(
				async (label, payload, options = {}) => {
					setBusy(label);
					setNotice({ kind: "", text: "" });
					try {
						const result = await callAction(payload);
						if (result.ok !== true) {
							setNotice({ kind: "error", text: result.error || "操作失败" });
						} else if (options.success !== undefined) {
							setNotice({ kind: "ok", text: options.success });
						}
						if (result.settings !== undefined) {
							// 动作可能已经改过设置（比如自动锁定节点），同步回来。
							void recheck();
						}
						return result;
					} catch (error) {
						setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });
						return null;
					} finally {
						setBusy("");
						void recheck();
					}
				},
				[recheck],
			);

			/** 保存一个设置项。 */
			const save = react.useCallback(
				async (field, value) => {
					try {
						await scope.set(field, value);
						return true;
					} catch (error) {
						setNotice({ kind: "error", text: `保存失败：${error instanceof Error ? error.message : String(error)}` });
						return false;
					}
				},
				[scope],
			);

			const core = status !== null && status.core !== undefined ? status.core : {};
			const proxy = status !== null && status.proxy !== undefined ? status.proxy : {};
			const subscription = status !== null && status.subscription !== undefined ? status.subscription : null;
			const groups = status !== null && Array.isArray(status.groups) ? status.groups : [];
			const nodeIndex = new Map(
				(status !== null && Array.isArray(status.proxies) ? status.proxies : []).map((node) => [node.name, node]),
			);

			const running = core.state === "running";
			const groupName =
				config.targetGroup !== "" && groups.some((group) => group.name === config.targetGroup)
					? config.targetGroup
					: (groups.find((group) => group.type === "select") || groups[0] || {}).name || "";
			const activeGroup = groups.find((group) => group.name === groupName);
			const members = activeGroup !== undefined && Array.isArray(activeGroup.members) ? activeGroup.members : [];
			const current = selection[groupName] !== undefined ? selection[groupName] : config.targetNode;

			/** 测速。 */
			const measure = react.useCallback(
				async (thenPickFastest) => {
					if (groupName === "") {
						setNotice({ kind: "error", text: "没有可用的分组，先刷新订阅" });
						return;
					}
					const result = await run(
						thenPickFastest === true ? "pick" : "delay",
						{ action: "delay", group: groupName, timeout: 5000, url: config.testUrl },
						{ success: thenPickFastest === true ? "" : "测速完成" },
					);
					if (result === null || result.ok !== true) return;
					const table = result.delays !== undefined && result.delays !== null ? result.delays : {};
					setDelays(table);
					const usable = Object.entries(table)
						.filter((entry) => typeof entry[1] === "number" && entry[1] > 0)
						.sort((a, b) => a[1] - b[1]);
					if (thenPickFastest === true) {
						if (usable.length === 0) {
							setNotice({ kind: "error", text: "所有节点都测不通" });
							return;
						}
						const fastest = usable[0];
						const picked = await run("pick", { action: "select", group: groupName, node: fastest[0] });
						if (picked !== null && picked.ok === true) {
							await save("targetNode", fastest[0]);
							await save("targetGroup", groupName);
							setSelection((previous) => Object.assign({}, previous, { [groupName]: fastest[0] }));
							setNotice({ kind: "ok", text: `已锁定最快节点：${fastest[0]}（${fastest[1]} ms）` });
						}
					} else {
						const count = usable.length;
						setNotice({
							kind: count === 0 ? "error" : "ok",
							text: count === 0 ? "所有节点都测不通" : `测速完成：${count}/${Object.keys(table).length} 个节点可用`,
						});
					}
				},
				[groupName, config.testUrl, run, save],
			);

			/** 选一个节点。 */
			const pick = react.useCallback(
				async (node) => {
					const result = await run("pick", { action: "select", group: groupName, node });
					if (result === null || result.ok !== true) return;
					await save("targetNode", node);
					await save("targetGroup", groupName);
					setSelection((previous) => Object.assign({}, previous, { [groupName]: node }));
					setNotice({ kind: "ok", text: `已切到 ${node}` });
				},
				[groupName, run, save],
			);

			/** 打开开关。 */
			const turnOn = react.useCallback(async () => {
				await save("enabled", true);
				if (config.subscriptionUrl.trim() === "") {
					setNotice({ kind: "error", text: "先填订阅地址" });
					return;
				}
				const result = await run("enable", { action: "enable" }, { success: "已开启：只有指定域名走代理，其余直连" });
				if (result !== null && result.ok === true) {
					// 没锁定节点时自动挑一个最快的 —— auto 组实测会抽风到 11 秒。
					if (config.targetNode === "") {
						setNotice({ kind: "ok", text: "已开启。auto 组不稳定，正在自动锁定最快节点…" });
						await measure(true);
					}
				} else {
					await save("enabled", false);
				}
			}, [config.subscriptionUrl, config.targetNode, save, run, measure]);

			/** 关闭开关。 */
			const turnOff = react.useCallback(async () => {
				await run("disable", { action: "disable" }, { success: "已关闭，全部直连" });
				await save("enabled", false);
			}, [run, save]);

			const urlValue = draftUrl !== null ? draftUrl : config.subscriptionUrl;
			const domainsValue = draftDomains !== null ? draftDomains : config.apiDomains;
			const testUrlValue = draftTestUrl !== null ? draftTestUrl : config.testUrl;

			/* ---------------------------------------------------------------- *
			 * 渲染
			 * ---------------------------------------------------------------- */

			const children = [];

			// 标题 + 一句话说明
			children.push(
				h(
					"div",
					{ key: "intro", className: "dap-help" },
					"给 DSH 的 API 请求单独挂梯子：本机跑一个 mihomo 核心，只有下面列的域名走代理，其余（网页抓取、搜索、MCP）一律直连。不开 TUN、不需要管理员权限、不影响系统其它软件。",
				),
			);

			if (statusError !== "") {
				children.push(
					h("div", { key: "status-error", className: "dap-error" }, `读不到宿主状态：${statusError}`),
				);
			}
			if (notice.text !== "") {
				children.push(
					h("div", { key: "notice", className: notice.kind === "error" ? "dap-error" : "dap-ok" }, notice.text),
				);
			}

			// ---- 状态 ----
			children.push(
				h(
					"div",
					{ key: "status", className: "dap-sec" },
					h(
						"div",
						{ className: "dap-row" },
						h("h3", { className: "dap-sec-title", style: { flex: "1" } }, "状态"),
						h(
							"span",
							{ className: proxy.installed === true ? "dap-badge dap-badge-on" : "dap-badge dap-badge-off" },
							proxy.installed === true ? "代理已挂上" : "直连中",
						),
						h(
							"span",
							{
								className:
									core.state === "running"
										? "dap-badge dap-badge-on"
										: core.state === "failed"
											? "dap-badge dap-badge-off"
											: "dap-badge dap-badge-idle",
							},
							core.state === "running"
								? "核心运行中"
								: core.state === "starting"
									? "启动中"
									: core.state === "failed"
										? "核心异常"
										: "核心已停",
						),
					),
					h(
						"dl",
						{ className: "dap-kv" },
						h("dt", null, "代理地址"),
						h("dd", null, proxy.url !== undefined && proxy.url !== null ? proxy.url : "—"),
						h("dt", null, "核心版本"),
						h("dd", null, core.version !== undefined && core.version !== null ? core.version : "—"),
						h("dt", null, "核心路径"),
						h("dd", null, core.path !== undefined ? core.path : "—"),
						h("dt", null, "走代理的域名"),
						h("dd", null, config.apiDomains !== "" ? config.apiDomains : "（空，等于全直连）"),
					),
					core.error !== undefined && core.error !== null && core.error !== ""
						? h("div", { className: "dap-error" }, core.error)
						: null,
					core.installed !== true
						? h(
								"div",
								{ className: "dap-row" },
								h(
									"button",
									{
										className: "dap-btn",
										disabled: busy !== "",
										onClick: () =>
											void run("install-core", { action: "install-core" }, { success: "核心已下载" }),
									},
									busy === "install-core" ? "下载中…" : "下载核心（约 21 MB）",
								),
								h("span", { className: "dap-help" }, "从 GitHub 下载 mihomo，失败会自动换国内镜像"),
							)
						: null,
					h(
						"div",
						{ className: "dap-row" },
						h(
							"button",
							{ className: "dap-btn", disabled: busy !== "" || proxy.installed === true, onClick: () => void turnOn() },
							busy === "enable" ? "开启中…" : "开启",
						),
						h(
							"button",
							{
								className: "dap-btn dap-btn-danger",
								disabled: busy !== "" || proxy.installed !== true,
								onClick: () => void turnOff(),
							},
							busy === "disable" ? "关闭中…" : "关闭",
						),
						h(
							"button",
							{
								className: "dap-btn dap-btn-quiet",
								disabled: busy !== "" || !running,
								onClick: () => void run("reload", { action: "reload" }, { success: "核心已重载" }),
							},
							"重载核心",
						),
						h(
							"button",
							{ className: "dap-btn dap-btn-quiet", disabled: busy !== "", onClick: () => void recheck() },
							"刷新状态",
						),
					),
				),
			);

			// ---- 订阅 ----
			const usage =
				subscription !== null && subscription.userinfo !== null && subscription.userinfo !== undefined
					? subscription.userinfo
					: null;
			const used = usage !== null ? (usage.upload || 0) + (usage.download || 0) : null;
			const ratio = usage !== null && usage.total ? Math.min(1, used / usage.total) : null;

			children.push(
				h(
					"div",
					{ key: "sub", className: "dap-sec" },
					h("h3", { className: "dap-sec-title" }, "订阅"),
					h("div", { className: "dap-label" }, "订阅地址（Clash / mihomo 格式）"),
					h("input", {
						className: "dap-input",
						type: "text",
						spellCheck: false,
						placeholder: "https://…",
						value: urlValue,
						onChange: (event) => setDraftUrl(event.target.value),
					}),
					h(
						"div",
						{ className: "dap-row" },
						h(
							"button",
							{
								className: "dap-btn",
								disabled: busy !== "",
								onClick: async () => {
									if (draftUrl !== null) {
										await save("subscriptionUrl", draftUrl);
										setDraftUrl(null);
									}
									const url = draftUrl !== null ? draftUrl : config.subscriptionUrl;
									if (url.trim() === "") {
										setNotice({ kind: "error", text: "先填订阅地址" });
										return;
									}
									const result = await run("refresh", { action: "refresh" });
									if (result !== null && result.ok === true) {
										setNotice({
											kind: "ok",
											text: `订阅已刷新：${Array.isArray(result.proxies) ? result.proxies.length : 0} 个节点`,
										});
									}
								},
							},
							busy === "refresh" ? "拉取中…" : "保存并刷新",
						),
						subscription !== null
							? h(
									"span",
									{ className: "dap-help" },
									`${subscription.nodeCount} 个节点 · 抓取于 ${new Date(subscription.fetchedAt).toLocaleString()}`,
								)
							: h("span", { className: "dap-help" }, "还没拉过订阅"),
					),
					usage !== null
						? h(
								"div",
								null,
								h(
									"div",
									{ className: "dap-meta", style: { marginBottom: "4px" } },
									h("span", null, `已用 ${formatBytes(used)}`),
									h("span", null, `总量 ${formatBytes(usage.total)}`),
									h("span", null, `到期 ${formatExpire(usage.expire)}`),
								),
								h(
									"div",
									{ className: "dap-bar" },
									h("div", { className: "dap-bar-fill", style: { width: `${Math.round((ratio || 0) * 100)}%` } }),
								),
							)
						: null,
					h(
						"div",
						{ className: "dap-help" },
						"订阅地址里含你的账号令牌，只存在本机设置文档里；机场要求 Clash 系 User-Agent，本插件已自动带上。",
					),
				),
			);

			// ---- 节点 ----
			if (groups.length > 0) {
				const rows = members.map((name) => {
					const meta = nodeIndex.get(name);
					const isCurrent = current === name;
					return h(
						"button",
						{
							key: name,
							className: isCurrent ? "dap-node dap-node-on" : "dap-node",
							disabled: busy !== "" || !running,
							onClick: () => void pick(name),
							title: meta !== undefined ? `${name} · ${meta.type}` : name,
						},
						h("span", { className: isCurrent ? "dap-dot dap-dot-on" : "dap-dot" }),
						h("span", { className: "dap-node-name" }, name),
						meta !== undefined ? h("span", { className: "dap-delay" }, meta.type) : null,
						h("span", { className: delayClass(delays[name]) }, delayText(delays[name])),
					);
				});

				children.push(
					h(
						"div",
						{ key: "nodes", className: "dap-sec" },
						h(
							"div",
							{ className: "dap-row" },
							h("h3", { className: "dap-sec-title", style: { flex: "1" } }, "节点"),
							h(
								"span",
								{ className: "dap-help" },
								`当前：${current !== "" ? current : "未指定（由分组策略决定）"}`,
							),
						),
						groups.length > 1
							? h(
									"div",
									null,
									h("div", { className: "dap-label" }, "分组"),
									h(
										"select",
										{
											className: "dap-input",
											value: groupName,
											onChange: (event) => {
												void save("targetGroup", event.target.value);
												setDelays({});
											},
										},
										groups.map((group) =>
											h("option", { key: group.name, value: group.name }, `${group.name}（${group.type}）`),
										),
									),
								)
							: null,
						h(
							"div",
							{ className: "dap-row" },
							h(
								"button",
								{ className: "dap-btn", disabled: busy !== "" || !running, onClick: () => void measure(false) },
								busy === "delay" ? "测速中…" : "测速",
							),
							h(
								"button",
								{
									className: "dap-btn dap-btn-quiet",
									disabled: busy !== "" || !running,
									onClick: () => void measure(true),
								},
								busy === "pick" ? "处理中…" : "测速并锁定最快",
							),
							h("span", { className: "dap-help" }, `测速目标：${config.testUrl}`),
						),
						h("div", { className: "dap-list" }, rows.length > 0 ? rows : h("div", { className: "dap-help", style: { padding: "8px" } }, "这个分组没有成员")),
						h(
							"div",
							{ className: "dap-help" },
							"建议用「测速并锁定最快」手选节点：订阅自带的自动选择组实测出现过 11 秒的抖动，锁定固定节点后延迟稳定得多。",
						),
					),
				);
			}

			// ---- 分流规则 ----
			children.push(
				h(
					"div",
					{ key: "rules", className: "dap-sec" },
					h("h3", { className: "dap-sec-title" }, "分流"),
					h("div", { className: "dap-label" }, "走代理的域名后缀（逗号、空格或换行分隔）"),
					h("textarea", {
						className: "dap-input dap-textarea",
						spellCheck: false,
						placeholder: "api.example.com\n另一个域名.com",
						value: domainsValue,
						onChange: (event) => setDraftDomains(event.target.value),
					}),
					config.apiDomains === ""
						? h(
								"div",
								{ className: "dap-error" },
								"现在是空的 —— 等于什么都不代理（规则只剩 MATCH,DIRECT）。填上你的 API 域名再点「保存并应用」。",
							)
						: null,
					h(
						"div",
						{ className: "dap-row" },
						h(
							"button",
							{
								className: "dap-btn",
								disabled: busy !== "",
								onClick: async () => {
									if (draftDomains === null) return;
									await save("apiDomains", draftDomains);
									setDraftDomains(null);
									const result = await run("reload", { action: "reload" }, { success: "分流规则已生效" });
									if (result === null || result.ok !== true) await save("apiDomains", config.apiDomains);
								},
							},
							busy === "reload" ? "应用中…" : "保存并应用",
						),
						h("span", { className: "dap-help" }, "改完会重载核心，正在跑的请求会中断"),
					),
					h("div", { className: "dap-label" }, "测速目标地址"),
					h(
						"div",
						{ className: "dap-row" },
						h("input", {
							className: "dap-input",
							style: { flex: "1", minWidth: "220px" },
							type: "text",
							spellCheck: false,
							value: testUrlValue,
							onChange: (event) => setDraftTestUrl(event.target.value),
						}),
						h(
							"button",
							{
								className: "dap-btn dap-btn-quiet",
								disabled: draftTestUrl === null,
								onClick: async () => {
									if (draftTestUrl === null) return;
									await save("testUrl", draftTestUrl);
									setDraftTestUrl(null);
									setNotice({ kind: "ok", text: "测速目标已保存" });
								},
							},
							"保存",
						),
					),
					h(
						"div",
						{ className: "dap-help" },
						"其余流量一律直连 —— 包括网页抓取、联网搜索和 HTTP MCP。web_fetch 打不开被墙的页面属于预期行为。",
					),
				),
			);

			return h("div", { className: "dap-col" }, children);
		}

		/* =================================================================== *
		 * 插件体
		 * =================================================================== */

		/**
		 * 客户端服务依赖。`settingsScope` / `configForms` 刻意不进这个列表 ——
		 * 0.2 删掉了前者，写进 inject 会让整个入口永远 pending。
		 */
		const inject = ["slots"];

		function apply(ctx) {
			// 先摆兜底作用域，命中哪一代设置 API 就换成哪一代。插槽在**渲染时**
			// 才取作用域，所以换作用域不需要重新注册插槽。
			const holder = { scope: createLocalScope() };
			const currentScope = () => holder.scope;

			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "api-proxy",
						order: 65,
						label: () => "API 代理",
						inject: () => ({ scope: currentScope() }),
					},
					ApiProxySectionEntry,
				),
			);

			// DSH ≥ 0.2：设置是这个 entry 的 config。
			ctx.inject(["configForms"], (inner) => {
				const adapted = adaptConfigForm(inner.configForms.get(CONFIG_ENTRY_ID));
				if (adapted !== undefined) holder.scope = adapted;
			});

			// DSH ≤ 0.1.5：老的命名空间作用域。
			ctx.inject(["settingsScope"], (inner) => {
				holder.scope = inner.settingsScope.bind({ namespace: SETTINGS_NS, decode: decodeSection });
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
