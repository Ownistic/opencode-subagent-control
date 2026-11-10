// @bun
// src/tui.tsx
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { effect as _$effect2 } from "@opentui/solid";
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { memo as _$memo2 } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { Plugin, usePlugin as usePlugin2 } from "@opencode/plugin/tui";
import { createMemo as createMemo2, createSignal as createSignal2, onCleanup as onCleanup2, onMount as onMount2, Show as Show2 } from "solid-js";

// src/model-options.ts
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
async function readModelPreferences(path = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode", "model.json")) {
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("Invalid preferences");
    const value = data;
    const parse = (items) => Array.isArray(items) ? items.flatMap((item) => item && typeof item === "object" && typeof item.providerID === "string" && typeof item.modelID === "string" ? [{ providerID: item.providerID, modelID: item.modelID }] : []) : [];
    return { favorite: parse(value.favorite), recent: parse(value.recent) };
  } catch {
    return { favorite: [], recent: [] };
  }
}
function modelOptions(models, preferences) {
  const seen = new Set;
  const key = (providerID, modelID) => JSON.stringify([providerID, modelID]);
  const group = (items, category) => items.flatMap((item) => {
    const id = key(item.providerID, item.modelID);
    const model = models.find((candidate) => candidate.providerID === item.providerID && candidate.id === item.modelID);
    if (!model || seen.has(id))
      return [];
    seen.add(id);
    return [{ title: model.name, description: model.providerID, category, value: model }];
  });
  const favorites = group(preferences.favorite, "Favorites");
  const recent = group(preferences.recent, "Recent");
  const rest = models.flatMap((model) => {
    const id = key(model.providerID, model.id);
    if (seen.has(id))
      return [];
    seen.add(id);
    return [{ title: model.name, description: model.providerID, category: model.providerID, value: model }];
  });
  return [...favorites, ...recent, ...rest];
}

// src/controls.ts
async function descendants(client, parentID) {
  const result = [];
  const pending = [parentID];
  const seen = new Set(pending);
  while (pending.length) {
    const parent = pending.shift();
    let cursor;
    do {
      const page = await client.session.list(cursor ? { cursor } : { parentID: parent, limit: 100 });
      for (const child of page.data) {
        if (seen.has(child.id))
          continue;
        seen.add(child.id);
        result.push(child);
        pending.push(child.id);
      }
      cursor = page.cursor.next ?? undefined;
    } while (cursor);
  }
  return result;
}
async function pickTarget(context) {
  const route = context.ui.router.current();
  if (route.type !== "session") {
    context.ui.toast.show({ message: "Open a session first", variant: "warning" });
    return;
  }
  const current = await context.client.session.get({ sessionID: route.sessionID });
  if (current.parentID)
    return current.id;
  const children = await descendants(context.client, current.id);
  if (!children.length) {
    context.ui.toast.show({ message: "No subagents found in this session", variant: "warning" });
    return;
  }
  return context.ui.dialog.select({
    title: "Select a subagent",
    options: children.map((child) => ({
      title: child.title || child.agent || child.id,
      description: `${child.agent ?? "subagent"} \xB7 ${child.id}`,
      value: child.id
    }))
  });
}
function controls(context) {
  const notify = (message) => context.ui.toast.show({ message, variant: "success" });
  const guarded = (action) => async (target) => {
    try {
      await action(target);
    } catch (error) {
      context.ui.toast.show({ title: "Subagent control failed", message: error instanceof Error ? error.message : String(error), variant: "error" });
    }
  };
  return {
    steer: guarded(async () => {
      const sessionID = await pickTarget(context);
      if (!sessionID)
        return;
      const text = await context.ui.dialog.prompt({ title: "Steer subagent", placeholder: "Enter an instruction" });
      if (!text?.trim())
        return;
      await context.client.session.prompt({ sessionID, text, delivery: "steer" });
      notify("Steering message submitted");
    }),
    model: guarded(async (target) => {
      const sessionID = target ?? await pickTarget(context);
      if (!sessionID)
        return;
      const session = await context.client.session.get({ sessionID });
      const models = (await context.client.model.list({ location: { directory: session.location.directory }, types: ["chat"] })).data.filter((model) => model.enabled && (!model.type || model.type === "chat"));
      const preferences = await readModelPreferences();
      const selected = await context.ui.dialog.select({
        title: "Select model",
        options: modelOptions(models, preferences)
      });
      if (!selected)
        return;
      const variant = selected.variants.length ? await context.ui.dialog.select({
        title: "Select model variant",
        options: [
          { title: "Default", value: "" },
          ...selected.variants.map((item) => ({ title: item.id, value: item.id }))
        ]
      }) : "";
      if (variant === undefined)
        return;
      await context.client.session.switchModel({ sessionID, model: { providerID: selected.providerID, id: selected.id, ...variant ? { variant } : {} } });
      notify("Model selected for subsequent requests");
    }),
    command: guarded(async () => {
      const sessionID = await pickTarget(context);
      if (!sessionID)
        return;
      const session = await context.client.session.get({ sessionID });
      const commands = (await context.client.command.list({ location: { directory: session.location.directory } })).data;
      if (!commands.length) {
        context.ui.toast.show({ message: "No server commands available", variant: "warning" });
        return;
      }
      const name = await context.ui.dialog.select({ title: "Run a subagent command", options: commands.map((item) => ({ title: `/${item.name}`, description: item.description, value: item.name })) });
      if (!name)
        return;
      const text = await context.ui.dialog.prompt({ title: `Arguments for /${name}`, placeholder: "Optional arguments" });
      if (text === undefined)
        return;
      await context.client.session.command({ sessionID, name, text, delivery: "steer" });
      notify(`Command /${name} submitted`);
    }),
    open: guarded(async () => {
      const sessionID = await pickTarget(context);
      if (sessionID)
        context.ui.router.navigate({ type: "session", sessionID });
    })
  };
}

// src/submit.ts
async function submitInput(context, sessionID, raw, selectModel) {
  const text = raw.trim();
  if (!text)
    return false;
  if (text === "/model") {
    await selectModel();
    return true;
  }
  if (text === "/subagent-panel") {
    if (!context.ui.panel.open("subagents-control.details"))
      throw new Error("Open a session first");
    return true;
  }
  if (text.startsWith("/")) {
    const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text);
    if (!match)
      return false;
    await context.client.session.command({ sessionID, name: match[1], text: match[2] ?? "", delivery: "steer" });
    return true;
  }
  await context.client.session.prompt({ sessionID, text, delivery: "steer" });
  return true;
}

// src/sidebar.tsx
import { effect as _$effect } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { usePlugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";

// src/session-data.ts
function todoMarker(status) {
  switch (status) {
    case "completed":
      return "[\u2713]";
    case "in_progress":
      return "[\u2022]";
    case "cancelled":
      return "[-]";
    default:
      return "[ ]";
  }
}
function visibleMessages(messages, boundary) {
  const index = boundary ? messages.findIndex((message) => message.id === boundary) : -1;
  return index < 0 ? messages : messages.slice(0, index);
}
function sessionTodos(messages, boundary) {
  const visible = visibleMessages(messages, boundary);
  for (let i = visible.length - 1;i >= 0; i--) {
    const message = visible[i];
    if (message.type !== "assistant")
      continue;
    for (let j = message.content.length - 1;j >= 0; j--) {
      const part = message.content[j];
      if (part.type !== "tool" || part.name !== "todowrite" || part.state.status !== "completed")
        continue;
      const items = part.state.input.todos;
      if (!Array.isArray(items))
        return [];
      return items.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.content !== "string" || !item.content)
          return [];
        const status = item.status === "in_progress" || item.status === "completed" || item.status === "cancelled" ? item.status : "pending";
        return [{ content: item.content, status }];
      });
    }
  }
  return [];
}
function contextUsage(messages, models, boundary) {
  const visible = visibleMessages(messages, boundary);
  for (let i = visible.length - 1;i >= 0; i--) {
    const message = visible[i];
    if (message.type === "compaction" && message.status === "completed")
      break;
    if (message.type !== "assistant" || !message.tokens)
      continue;
    const token = message.tokens;
    const tokens = token.input + token.output + token.reasoning + token.cache.read + token.cache.write;
    if (!tokens)
      continue;
    const limit = models?.find((model) => model.providerID === message.model.providerID && model.id === message.model.id)?.limit.context;
    return { tokens, percent: limit ? Math.round(tokens / limit * 100) : undefined };
  }
}

// src/magic-context.ts
import { createHash } from "crypto";
import { readdir, readFile as readFile2 } from "fs/promises";
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
async function magicSnapshot(directory, sessionId) {
  if (!directory || !sessionId)
    return;
  const hash = createHash("sha256").update(directory.replace(/\/+$/, "")).digest("hex").slice(0, 16);
  const root = join2(process.env.XDG_DATA_HOME ?? join2(homedir2(), ".local", "share"), "cortexkit", "magic-context", "rpc", hash);
  let files;
  try {
    files = (await readdir(root)).filter((file) => /^port-.*\.json$/.test(file));
  } catch {
    return;
  }
  const records = await Promise.all(files.map(async (file) => {
    try {
      const record = JSON.parse(await readFile2(join2(root, file), "utf8"));
      if (!Number.isInteger(record.port) || record.port < 1 || record.port > 65535 || !Number.isInteger(record.pid) || typeof record.token !== "string" || typeof record.instance_id !== "string")
        return;
      return record;
    } catch {
      return;
    }
  }));
  for (const record of records.filter((item) => item !== undefined).sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0))) {
    try {
      const origin = `http://127.0.0.1:${record.port}`;
      const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1500) });
      if (!health.ok)
        continue;
      const info = await health.json();
      if (info.pid !== record.pid || info.instance_id !== record.instance_id)
        continue;
      const response = await fetch(`${origin}/rpc/sidebar-snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${record.token}` },
        body: JSON.stringify({ sessionId, directory }),
        signal: AbortSignal.timeout(3000)
      });
      if (!response.ok)
        continue;
      const result = await response.json();
      if (result.sessionId !== sessionId || typeof result.inputTokens !== "number" || typeof result.contextLimit !== "number" || typeof result.compartmentCount !== "number" || typeof result.memoryCount !== "number" || typeof result.historianRunning !== "boolean")
        continue;
      return result;
    } catch {}
  }
}

// src/sidebar.tsx
var PANEL = "subagents-control.details";
function Sidebar(props) {
  const context = usePlugin();
  const id = () => props.panel.sessionID;
  const session = () => context.data.session.get(id());
  const messages = () => context.data.session.message.list(id());
  const todos = createMemo(() => sessionTodos(messages(), session()?.revert?.messageID));
  const [todoView, updateTodoView] = context.storage.store("todo-view", {
    initial: {
      open: true
    }
  });
  const remainingTodos = createMemo(() => todos().filter((todo) => todo.status === "pending" || todo.status === "in_progress").length);
  const usage = createMemo(() => contextUsage(messages(), context.data.location.model.list(session()?.location), session()?.revert?.messageID));
  const [magic, setMagic] = createSignal();
  createEffect(() => {
    const sessionID = id();
    const directory = session()?.location.directory;
    setMagic(undefined);
    if (!directory)
      return;
    let disposed = false;
    let request = 0;
    const refresh = () => {
      const sequence = ++request;
      magicSnapshot(directory, sessionID).then((snapshot) => {
        if (!disposed && sequence === request)
          setMagic(snapshot);
      });
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    onCleanup(() => {
      disposed = true;
      clearInterval(timer);
    });
  });
  onMount(() => {
    context.data.session.message.sync(id()).catch(() => {});
    context.data.location.model.sync(session()?.location).catch(() => {});
  });
  return (() => {
    var _el$ = _$createElement("box"), _el$2 = _$createElement("text"), _el$3 = _$createElement("b"), _el$4 = _$createElement("scrollbox"), _el$5 = _$createElement("box"), _el$6 = _$createElement("box"), _el$7 = _$createElement("text"), _el$8 = _$createElement("b"), _el$0 = _$createElement("text"), _el$1 = _$createTextNode(`$`), _el$10 = _$createTextNode(` spent`), _el$20 = _$createElement("box"), _el$21 = _$createElement("text"), _el$22 = _$createElement("b"), _el$24 = _$createElement("box"), _el$25 = _$createElement("text"), _el$26 = _$createElement("b"), _el$28 = _$createElement("text"), _el$29 = _$createTextNode(` \xB7 `);
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$4);
    _$setProp(_el$, "height", "100%");
    _$setProp(_el$, "padding", 1);
    _$setProp(_el$, "flexDirection", "column");
    _$insertNode(_el$2, _el$3);
    _$insert(_el$3, () => session()?.title ?? "Subagent");
    _$insertNode(_el$4, _el$5);
    _$setProp(_el$4, "flexGrow", 1);
    _$setProp(_el$4, "minHeight", 0);
    _$setProp(_el$4, "horizontalScrollbarOptions", {
      visible: false
    });
    _$insertNode(_el$5, _el$6);
    _$insertNode(_el$5, _el$20);
    _$insertNode(_el$5, _el$24);
    _$setProp(_el$5, "gap", 1);
    _$setProp(_el$5, "flexDirection", "column");
    _$setProp(_el$5, "paddingTop", 1);
    _$insertNode(_el$6, _el$7);
    _$insertNode(_el$6, _el$0);
    _$insertNode(_el$7, _el$8);
    _$insertNode(_el$8, _$createTextNode(`Context`));
    _$insert(_el$6, _$createComponent(Show, {
      get when() {
        return usage();
      },
      get fallback() {
        return (() => {
          var _el$30 = _$createElement("text");
          _$insertNode(_el$30, _$createTextNode(`No usage available yet`));
          _$effect((_$p) => _$setProp(_el$30, "fg", context.theme.text.muted, _$p));
          return _el$30;
        })();
      },
      children: (value) => [(() => {
        var _el$32 = _$createElement("text"), _el$33 = _$createTextNode(` tokens`);
        _$insertNode(_el$32, _el$33);
        _$insert(_el$32, () => value().tokens.toLocaleString(), _el$33);
        _$effect((_$p) => _$setProp(_el$32, "fg", context.theme.text.muted, _$p));
        return _el$32;
      })(), _$createComponent(Show, {
        get when() {
          return value().percent !== undefined;
        },
        get children() {
          var _el$34 = _$createElement("text"), _el$35 = _$createTextNode(`% used`);
          _$insertNode(_el$34, _el$35);
          _$insert(_el$34, () => value().percent, _el$35);
          _$effect((_$p) => _$setProp(_el$34, "fg", context.theme.text.muted, _$p));
          return _el$34;
        }
      })]
    }), _el$0);
    _$insertNode(_el$0, _el$1);
    _$insertNode(_el$0, _el$10);
    _$insert(_el$0, () => context.data.session.cost(id()).toFixed(4), _el$10);
    _$insert(_el$5, _$createComponent(Show, {
      get when() {
        return todos().length > 0;
      },
      get children() {
        var _el$11 = _$createElement("box"), _el$12 = _$createElement("box"), _el$14 = _$createElement("text"), _el$15 = _$createElement("b");
        _$insertNode(_el$11, _el$12);
        _$setProp(_el$11, "flexDirection", "column");
        _$insertNode(_el$12, _el$14);
        _$setProp(_el$12, "flexDirection", "row");
        _$setProp(_el$12, "gap", 1);
        _$setProp(_el$12, "onMouseDown", () => {
          if (todos().length <= 2)
            return;
          updateTodoView((view) => {
            view.open = !view.open;
          }).catch(() => {
            context.ui.toast.show({
              message: "Could not save Todo view",
              variant: "error"
            });
          });
        });
        _$insert(_el$12, _$createComponent(Show, {
          get when() {
            return todos().length > 2;
          },
          get children() {
            var _el$13 = _$createElement("text");
            _$insert(_el$13, () => todoView.open ? "\u25BC" : "\u25B6");
            _$effect((_$p) => _$setProp(_el$13, "fg", context.theme.text.base, _$p));
            return _el$13;
          }
        }), _el$14);
        _$insertNode(_el$14, _el$15);
        _$insertNode(_el$15, _$createTextNode(`Todo`));
        _$insert(_el$14, _$createComponent(Show, {
          get when() {
            return _$memo(() => todos().length > 2)() && !todoView.open;
          },
          get children() {
            var _el$17 = _$createElement("span"), _el$18 = _$createTextNode(` (`), _el$19 = _$createTextNode(` remaining)`);
            _$insertNode(_el$17, _el$18);
            _$insertNode(_el$17, _el$19);
            _$insert(_el$17, remainingTodos, _el$19);
            _$effect((_$p) => _$setProp(_el$17, "style", {
              fg: context.theme.text.muted
            }, _$p));
            return _el$17;
          }
        }), null);
        _$insert(_el$11, _$createComponent(Show, {
          get when() {
            return todos().length <= 2 || todoView.open;
          },
          get children() {
            return _$createComponent(For, {
              get each() {
                return todos();
              },
              children: (todo) => {
                const color = () => todo.status === "in_progress" ? context.theme.text.feedback.warning.base : todo.status === "cancelled" ? context.theme.text.faint : context.theme.text.muted;
                return (() => {
                  var _el$36 = _$createElement("box"), _el$37 = _$createElement("text"), _el$38 = _$createTextNode(` `), _el$39 = _$createElement("text");
                  _$insertNode(_el$36, _el$37);
                  _$insertNode(_el$36, _el$39);
                  _$setProp(_el$36, "flexDirection", "row");
                  _$insertNode(_el$37, _el$38);
                  _$setProp(_el$37, "flexShrink", 0);
                  _$insert(_el$37, () => todoMarker(todo.status), _el$38);
                  _$setProp(_el$39, "flexGrow", 1);
                  _$setProp(_el$39, "minWidth", 0);
                  _$setProp(_el$39, "wrapMode", "word");
                  _$insert(_el$39, () => todo.content);
                  _$effect((_p$) => {
                    var _v$8 = color(), _v$9 = color(), _v$0 = todo.status === "cancelled" ? TextAttributes.STRIKETHROUGH : undefined;
                    _v$8 !== _p$.e && (_p$.e = _$setProp(_el$37, "fg", _v$8, _p$.e));
                    _v$9 !== _p$.t && (_p$.t = _$setProp(_el$39, "fg", _v$9, _p$.t));
                    _v$0 !== _p$.a && (_p$.a = _$setProp(_el$39, "attributes", _v$0, _p$.a));
                    return _p$;
                  }, {
                    e: undefined,
                    t: undefined,
                    a: undefined
                  });
                  return _el$36;
                })();
              }
            });
          }
        }), null);
        _$effect((_$p) => _$setProp(_el$14, "fg", context.theme.text.base, _$p));
        return _el$11;
      }
    }), _el$20);
    _$insertNode(_el$20, _el$21);
    _$insertNode(_el$21, _el$22);
    _$insertNode(_el$22, _$createTextNode(`Magic Context`));
    _$insert(_el$20, _$createComponent(Show, {
      get when() {
        return magic();
      },
      get fallback() {
        return (() => {
          var _el$40 = _$createElement("text");
          _$insertNode(_el$40, _$createTextNode(`Session data unavailable`));
          _$effect((_$p) => _$setProp(_el$40, "fg", context.theme.text.muted, _$p));
          return _el$40;
        })();
      },
      children: (snapshot) => [(() => {
        var _el$42 = _$createElement("text"), _el$43 = _$createTextNode(` / `), _el$44 = _$createTextNode(` tokens`);
        _$insertNode(_el$42, _el$43);
        _$insertNode(_el$42, _el$44);
        _$insert(_el$42, () => snapshot().inputTokens.toLocaleString(), _el$43);
        _$insert(_el$42, () => snapshot().contextLimit.toLocaleString(), _el$44);
        _$effect((_$p) => _$setProp(_el$42, "fg", context.theme.text.muted, _$p));
        return _el$42;
      })(), (() => {
        var _el$45 = _$createElement("text"), _el$46 = _$createTextNode(` compartments \xB7 `), _el$47 = _$createTextNode(` memories`);
        _$insertNode(_el$45, _el$46);
        _$insertNode(_el$45, _el$47);
        _$insert(_el$45, () => snapshot().compartmentCount, _el$46);
        _$insert(_el$45, () => snapshot().memoryCount, _el$47);
        _$effect((_$p) => _$setProp(_el$45, "fg", context.theme.text.muted, _$p));
        return _el$45;
      })(), (() => {
        var _el$48 = _$createElement("text"), _el$49 = _$createTextNode(`Historian: `);
        _$insertNode(_el$48, _el$49);
        _$insert(_el$48, () => snapshot().historianRunning ? "running" : "idle", null);
        _$effect((_$p) => _$setProp(_el$48, "fg", context.theme.text.muted, _$p));
        return _el$48;
      })()]
    }), null);
    _$insertNode(_el$24, _el$25);
    _$insertNode(_el$24, _el$28);
    _$insertNode(_el$25, _el$26);
    _$insertNode(_el$26, _$createTextNode(`Session`));
    _$insertNode(_el$28, _el$29);
    _$insert(_el$28, () => session()?.agent ?? "Subagent", _el$29);
    _$insert(_el$28, () => context.data.session.status(id()), null);
    _$insert(_el$24, _$createComponent(Show, {
      get when() {
        return session()?.model;
      },
      children: (model) => (() => {
        var _el$50 = _$createElement("text"), _el$51 = _$createTextNode(`/`);
        _$insertNode(_el$50, _el$51);
        _$insert(_el$50, () => model().providerID, _el$51);
        _$insert(_el$50, () => model().id, null);
        _$insert(_el$50, (() => {
          var _c$ = _$memo(() => !!model().variant);
          return () => _c$() ? ` \xB7 ${model().variant}` : "";
        })(), null);
        _$effect((_$p) => _$setProp(_el$50, "fg", context.theme.text.muted, _$p));
        return _el$50;
      })()
    }), null);
    _$insert(_el$24, _$createComponent(Show, {
      get when() {
        return session()?.location.directory;
      },
      children: (directory) => (() => {
        var _el$52 = _$createElement("text");
        _$insert(_el$52, () => context.ui.format.path(directory()));
        _$effect((_$p) => _$setProp(_el$52, "fg", context.theme.text.muted, _$p));
        return _el$52;
      })()
    }), null);
    _$effect((_p$) => {
      var _v$ = context.theme.background.raised.base, _v$2 = context.theme.text.base, _v$3 = context.theme.text.base, _v$4 = context.theme.text.muted, _v$5 = context.theme.text.base, _v$6 = context.theme.text.base, _v$7 = context.theme.text.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "backgroundColor", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$2, "fg", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$7, "fg", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$0, "fg", _v$4, _p$.o));
      _v$5 !== _p$.i && (_p$.i = _$setProp(_el$21, "fg", _v$5, _p$.i));
      _v$6 !== _p$.n && (_p$.n = _$setProp(_el$25, "fg", _v$6, _p$.n));
      _v$7 !== _p$.s && (_p$.s = _$setProp(_el$28, "fg", _v$7, _p$.s));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined
    });
    return _el$;
  })();
}

// src/tui.tsx
function ChildInput(props) {
  const context = usePlugin2();
  const [busy, setBusy] = createSignal2(false);
  const [draft, setDraft] = createSignal2("");
  const [focused, setFocused] = createSignal2(false);
  const [lines, setLines] = createSignal2(1);
  const session = () => context.data.session.get(props.sessionID);
  const modelLabel = createMemo2(() => {
    const model = session()?.model;
    if (!model)
      return "Default model";
    const match = context.data.location.model.list(session()?.location)?.find((item) => item.providerID === model.providerID && item.id === model.id);
    return `${match?.name ?? model.id}${model.variant ? ` \xB7 ${model.variant}` : ""}`;
  });
  const suggestions = createMemo2(() => {
    const value = draft();
    if (!/^\/[^\s]*$/.test(value))
      return [];
    const commands = context.data.location.command.list(context.data.session.get(props.sessionID)?.location) ?? [];
    return [...new Set(["model", "subagent-panel", ...commands.map((command) => command.name)])].filter((name) => name.startsWith(value.slice(1))).slice(0, 5);
  });
  let input;
  let popMode;
  const release = () => {
    popMode?.();
    popMode = undefined;
    setFocused(false);
  };
  const focus = () => {
    if (!input)
      return;
    if (!popMode)
      popMode = context.keymap.mode.push("subagent-input");
    input.focus();
    setFocused(true);
  };
  context.keymap.layer(() => ({
    mode: "global",
    commands: [{
      id: "subagents.input.focus",
      title: "Focus subagent input",
      group: "Subagents",
      palette: true,
      bind: "ctrl+alt+i",
      run: focus
    }],
    bindings: ["subagents.input.focus"]
  }));
  context.keymap.layer(() => ({
    mode: "subagent-input",
    commands: [{
      bind: "escape",
      run: () => {
        input?.blur();
        release();
      }
    }, {
      bind: "tab",
      run: () => {
        const choice = suggestions()[0];
        if (choice && input) {
          input.setText(`/${choice} `);
          input.gotoBufferEnd();
        }
      }
    }]
  }));
  context.keymap.layer(() => ({
    mode: "composer",
    priority: 10,
    commands: [{
      bind: "return",
      run: () => {
        if (!context.keymap.commands().some((command) => command.id === "composer.subagent.select"))
          return false;
        context.keymap.dispatch("composer.subagent.select");
        context.renderer.requestAnimationFrame(() => {
          const route = context.ui.router.current();
          if (route.type === "session" && route.sessionID === props.sessionID && input && !input.isDestroyed)
            focus();
        });
      }
    }]
  }));
  onMount2(() => {
    context.data.location.command.sync(context.data.session.get(props.sessionID)?.location).catch(() => {});
    context.data.location.model.sync(session()?.location).catch(() => {});
    if (context.renderer.terminalWidth > 120)
      context.ui.panel.open(PANEL);
    context.renderer.requestAnimationFrame(() => {
      if (input && !input.isDestroyed)
        focus();
    });
  });
  onCleanup2(() => {
    release();
    context.ui.panel.close();
  });
  const submit = async (value) => {
    if (busy() || !value.trim())
      return;
    setBusy(true);
    try {
      const accepted = await submitInput(context, props.sessionID, value, () => controls(context).model(props.sessionID));
      if (accepted && input && input.plainText === value)
        input.clear();
    } catch (error) {
      context.ui.toast.show({
        title: "Could not submit to subagent",
        message: error instanceof Error ? error.message : String(error),
        variant: "error"
      });
    } finally {
      setBusy(false);
    }
  };
  return (() => {
    var _el$ = _$createElement2("box"), _el$2 = _$createElement2("box"), _el$3 = _$createElement2("box"), _el$4 = _$createElement2("textarea"), _el$5 = _$createElement2("box"), _el$6 = _$createElement2("text"), _el$7 = _$createElement2("b"), _el$8 = _$createElement2("text"), _el$1 = _$createElement2("text");
    _$insertNode2(_el$, _el$2);
    _$insertNode2(_el$, _el$1);
    _$setProp2(_el$, "flexDirection", "column");
    _$setProp2(_el$, "paddingLeft", 1);
    _$setProp2(_el$, "paddingRight", 1);
    _$insertNode2(_el$2, _el$3);
    _$setProp2(_el$2, "border", ["left"]);
    _$setProp2(_el$2, "borderStyle", "heavy");
    _$insertNode2(_el$3, _el$4);
    _$insertNode2(_el$3, _el$5);
    _$setProp2(_el$3, "flexDirection", "column");
    _$setProp2(_el$3, "flexGrow", 1);
    _$setProp2(_el$3, "minWidth", 0);
    _$setProp2(_el$3, "paddingLeft", 2);
    _$setProp2(_el$3, "paddingRight", 2);
    _$setProp2(_el$3, "paddingTop", 1);
    _$use((value) => {
      input = value;
      value.on("blurred", release);
    }, _el$4);
    _$setProp2(_el$4, "width", "100%");
    _$setProp2(_el$4, "minHeight", 1);
    _$setProp2(_el$4, "wrapMode", "word");
    _$setProp2(_el$4, "backgroundColor", "transparent");
    _$setProp2(_el$4, "focusedBackgroundColor", "transparent");
    _$setProp2(_el$4, "keyBindings", [{
      name: "return",
      action: "submit"
    }, {
      name: "return",
      shift: true,
      action: "newline"
    }]);
    _$setProp2(_el$4, "onMouseDown", focus);
    _$setProp2(_el$4, "onContentChange", () => {
      if (input) {
        setDraft(input.plainText);
        setLines(Math.max(1, input.virtualLineCount));
      }
    });
    _$setProp2(_el$4, "onSubmit", () => {
      if (input)
        submit(input.plainText);
    });
    _$insertNode2(_el$5, _el$6);
    _$insertNode2(_el$5, _el$8);
    _$setProp2(_el$5, "flexDirection", "row");
    _$setProp2(_el$5, "paddingTop", 1);
    _$setProp2(_el$5, "gap", 1);
    _$setProp2(_el$5, "minWidth", 0);
    _$insertNode2(_el$6, _el$7);
    _$setProp2(_el$6, "wrapMode", "none");
    _$setProp2(_el$6, "truncate", true);
    _$insert2(_el$7, () => session()?.agent ?? "Subagent");
    _$setProp2(_el$8, "flexShrink", 1);
    _$setProp2(_el$8, "wrapMode", "none");
    _$setProp2(_el$8, "truncate", true);
    _$setProp2(_el$8, "onMouseUp", (event) => {
      if (event.button !== 0)
        return;
      event.stopPropagation();
      controls(context).model(props.sessionID);
    });
    _$insert2(_el$8, modelLabel);
    _$insert2(_el$, _$createComponent2(Show2, {
      get when() {
        return suggestions().length > 0;
      },
      get children() {
        var _el$9 = _$createElement2("text"), _el$0 = _$createTextNode2(`Tab: `);
        _$insertNode2(_el$9, _el$0);
        _$insert2(_el$9, () => suggestions().map((item) => `/${item}`).join("  "), null);
        _$effect2((_$p) => _$setProp2(_el$9, "fg", context.theme.text.muted, _$p));
        return _el$9;
      }
    }), _el$1);
    _$insertNode2(_el$1, _$createTextNode2(`enter send \xB7 shift+enter newline \xB7 /model \xB7 esc subagents`));
    _$setProp2(_el$1, "wrapMode", "none");
    _$setProp2(_el$1, "truncate", true);
    _$effect2((_p$) => {
      var _v$ = focused() ? context.theme.hue.accent[500] : context.theme.text.muted, _v$2 = context.theme.decrease(context.theme.background.raised.base), _v$3 = Math.max(3, Math.floor(context.renderer.terminalHeight / 3)), _v$4 = lines(), _v$5 = context.theme.text.base, _v$6 = context.theme.text.base, _v$7 = context.theme.text.muted, _v$8 = context.theme.text.base, _v$9 = busy() ? "Submitting\u2026" : "Steer this subagent\u2026", _v$0 = context.theme.text.base, _v$1 = context.theme.text.muted, _v$10 = context.theme.text.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp2(_el$2, "borderColor", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp2(_el$3, "backgroundColor", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp2(_el$4, "maxHeight", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp2(_el$4, "height", _v$4, _p$.o));
      _v$5 !== _p$.i && (_p$.i = _$setProp2(_el$4, "textColor", _v$5, _p$.i));
      _v$6 !== _p$.n && (_p$.n = _$setProp2(_el$4, "focusedTextColor", _v$6, _p$.n));
      _v$7 !== _p$.s && (_p$.s = _$setProp2(_el$4, "placeholderColor", _v$7, _p$.s));
      _v$8 !== _p$.h && (_p$.h = _$setProp2(_el$4, "cursorColor", _v$8, _p$.h));
      _v$9 !== _p$.r && (_p$.r = _$setProp2(_el$4, "placeholder", _v$9, _p$.r));
      _v$0 !== _p$.d && (_p$.d = _$setProp2(_el$6, "fg", _v$0, _p$.d));
      _v$1 !== _p$.l && (_p$.l = _$setProp2(_el$8, "fg", _v$1, _p$.l));
      _v$10 !== _p$.u && (_p$.u = _$setProp2(_el$1, "fg", _v$10, _p$.u));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined,
      h: undefined,
      r: undefined,
      d: undefined,
      l: undefined,
      u: undefined
    });
    return _el$;
  })();
}
var tui_default = Plugin.define({
  id: "subagents-control.tui",
  setup(context) {
    const actions = controls(context);
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "subagents.steer",
        title: "Steer subagent",
        group: "Subagents",
        palette: true,
        slash: {
          name: "subagent-steer"
        },
        run: actions.steer
      }, {
        id: "subagents.model",
        title: "Change subagent model",
        group: "Subagents",
        palette: true,
        slash: {
          name: "subagent-model"
        },
        run: actions.model
      }, {
        id: "subagents.command",
        title: "Run subagent command",
        group: "Subagents",
        palette: true,
        slash: {
          name: "subagent-command"
        },
        run: actions.command
      }, {
        id: "subagents.open",
        title: "Open subagent",
        group: "Subagents",
        palette: true,
        slash: {
          name: "subagent-open"
        },
        run: actions.open
      }, {
        id: "subagents.panel",
        title: "Open session details panel",
        group: "Subagents",
        palette: true,
        slash: {
          name: "subagent-panel"
        },
        run: () => {
          if (!context.ui.panel.open(PANEL))
            context.ui.toast.show({
              message: "Open a session first",
              variant: "warning"
            });
        }
      }]
    }));
    const stopPanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => _$createComponent2(Show2, {
        get when() {
          return panel.name === PANEL;
        },
        get children() {
          return _$createComponent2(Sidebar, {
            panel
          });
        }
      })
    });
    const stopInput = context.ui.slot({
      append: "session.composer.top",
      render: ({
        sessionID
      }) => _$createComponent2(Show2, {
        get when() {
          return context.data.session.get(sessionID)?.parentID;
        },
        get children() {
          return _$createComponent2(ChildInput, {
            sessionID
          });
        }
      })
    });
    return () => {
      stopInput();
      stopPanel();
    };
  }
});
export {
  tui_default as default
};
