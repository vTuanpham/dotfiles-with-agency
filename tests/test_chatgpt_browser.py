"""The WSL transport reads current app config without rewriting the native host."""

import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path, PureWindowsPath
import tempfile
import unittest
from unittest.mock import patch


script = Path(__file__).resolve().parents[1] / "chrome/.local/bin/chatgpt-browser"
loader = importlib.machinery.SourceFileLoader("chatgpt_browser", str(script))
spec = importlib.util.spec_from_loader(loader.name, loader)
browser = importlib.util.module_from_spec(spec)
loader.exec_module(browser)


class BrowserTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.mapper = patch.object(browser, "wsl_path", self.map_path)
        self.mapper.start()
        self.addCleanup(self.mapper.stop)
        self.plugin = self.map_path("C:/plugins/chrome/current")
        self.service_plugin = self.map_path("C:/plugins/browser/current")
        self.host = self.plugin / "extension-host/windows/x64/extension-host.exe"
        self.service = "C:/plugins/browser/current/scripts/browser-service.mjs"
        self.env = {key: "app value" for key in browser.RUNTIME_ENV}
        self.env.update(
            NODE_REPL_NODE_PATH="C:/runtime/node.exe", CODEX_CLI_PATH="C:/runtime/codex.exe",
            NODE_REPL_TRUSTED_SERVICES=json.dumps({"browser": self.service, "sky": "@oai/sky/service"}),
        )
        self.manifest = {
            "name": browser.HOST, "type": "stdio",
            "path": "C:/plugins/chrome/current/extension-host/windows/x64/extension-host.exe",
            "allowed_origins": ["chrome-extension://hehggadaopoacecdllhhajmbjkdcmajg/"],
        }
        for name in ("C:/runtime/node.exe", "C:/runtime/codex.exe", "C:/runtime/node_repl.exe",
                     "C:/plugins/chrome/current/scripts/browser-client.mjs", self.service,
                     "C:/plugins/chrome/current/skills/control-chrome/SKILL.md", self.manifest["path"]):
            path = self.map_path(name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch()
        self.metadata(self.plugin, "chrome")
        self.metadata(self.service_plugin, "browser")
        self.write_config()

    def map_path(self, value):
        return self.home.joinpath(*PureWindowsPath(value).parts[1:])

    def metadata(self, root, name, version="current"):
        path = root / ".codex-plugin/plugin.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"name": name, "version": version}))

    def write_config(self, args="[]", command="C:/runtime/node_repl.exe"):
        config = self.home / ".codex/config.toml"
        config.parent.mkdir(exist_ok=True)
        config.write_text(
            '[mcp_servers.node_repl]\ncommand = ' + json.dumps(command) + '\nargs = ' + args
            + '\n[mcp_servers.node_repl.env]\n'
            + "\n".join(f"{key} = {json.dumps(value)}" for key, value in self.env.items())
            + '\nSKY_CUA_NATIVE_PIPE = "not a browser service"\n'
        )

    def test_current_app_setup_needs_no_sidecar_and_only_forwards_browser(self):
        before = {p: p.read_bytes() for p in self.home.rglob("*") if p.is_file()}
        host, command, env, paths = browser.load_setup(self.home, self.manifest)
        self.assertEqual(host, self.host)
        self.assertEqual(command, self.map_path("C:/runtime/node_repl.exe"))
        self.assertEqual(json.loads(env["NODE_REPL_TRUSTED_SERVICES"]),
                         {"browser": r"C:\plugins\browser\current\scripts\browser-service.mjs"})
        self.assertEqual(env["BROWSER_USE_AVAILABLE_BACKENDS"], "chrome")
        self.assertNotIn("SKY_CUA_NATIVE_PIPE", env)
        self.assertEqual(set(env["WSLENV"].split(":")), {key + "/w" for key in env if key != "WSLENV"})
        self.assertEqual(paths["client_url"], "file:///C:/plugins/chrome/current/scripts/browser-client.mjs")
        self.assertEqual(before, {p: p.read_bytes() for p in self.home.rglob("*") if p.is_file()})
        self.assertFalse((host.parent / "extension-host-config.json").exists())

    def test_runtime_updates_follow_the_app_even_when_old_runtime_remains(self):
        for release in ("runtime-2", "runtime-3"):
            for name in ("node.exe", "codex.exe", "node_repl.exe"):
                path = self.map_path(f"C:/{release}/{name}")
                path.parent.mkdir(exist_ok=True)
                path.touch()
            self.env.update(NODE_REPL_NODE_PATH=f"C:/{release}/node.exe",
                            CODEX_CLI_PATH=f"C:/{release}/codex.exe")
            self.write_config(command=f"C:/{release}/node_repl.exe")
            with patch.object(browser, "read_registration", return_value=(self.home, self.manifest)), \
                    patch.object(browser.sys, "stdout", io.StringIO()) as output:
                self.assertEqual(browser.discover()[2][1], self.map_path(f"C:/{release}/node_repl.exe"))
            self.assertEqual(output.getvalue(), "")
            self.assertTrue(self.map_path("C:/runtime/node_repl.exe").is_file())

    def test_refuses_invalid_manifests_origins_and_missing_host(self):
        for manifest in ({**self.manifest, "allowed_origins": ["*"]},
                         {**self.manifest, "name": "another.host"}, None):
            with self.subTest(manifest=manifest), self.assertRaises(ValueError):
                browser.load_setup(self.home, manifest)
        with self.assertRaisesRegex(ValueError, "origin"):
            browser.native_host_path(self.manifest, origin="chrome-extension://unapproved/")
        self.host.unlink()
        with self.assertRaisesRegex(ValueError, "missing"):
            browser.load_setup(self.home, self.manifest)

    def test_refuses_unexpected_host_layout(self):
        path = self.map_path("C:/another-host.exe")
        path.touch()
        with self.assertRaisesRegex(ValueError, "layout"):
            browser.load_setup(self.home, {**self.manifest, "path": "C:/another-host.exe"})

    def test_missing_runtime_and_nonempty_arguments_are_refused(self):
        self.write_config(args='["--disable-sandbox"]')
        with self.assertRaisesRegex(ValueError, "arguments"):
            browser.load_setup(self.home, self.manifest)
        self.write_config()
        self.map_path("C:/runtime/node_repl.exe").unlink()
        with self.assertRaisesRegex(ValueError, "missing"):
            browser.load_setup(self.home, self.manifest)

    def test_invalid_app_configuration_is_refused(self):
        config = self.home / ".codex/config.toml"
        for payload in ('[mcp_servers]\nnode_repl = "invalid"\n',
                        '[mcp_servers.node_repl]\nenv = "invalid"\n'):
            with self.subTest(payload=payload):
                config.write_text(payload)
                with self.assertRaisesRegex(ValueError, "configuration"):
                    browser.load_setup(self.home, self.manifest)

    def test_refuses_invalid_or_mismatched_service_metadata(self):
        for value in ("not JSON", "[]", "{}", '{"browser":"C:/service.js"}'):
            with self.subTest(value=value):
                self.env["NODE_REPL_TRUSTED_SERVICES"] = value
                self.write_config()
                with self.assertRaises(ValueError):
                    browser.load_setup(self.home, self.manifest)
        self.env["NODE_REPL_TRUSTED_SERVICES"] = json.dumps({"browser": self.service})
        self.write_config()
        for name, version in (("browser", "older"), ("another", "current"), ("browser", False)):
            self.metadata(self.service_plugin, name, version)
            with self.subTest(name=name, version=version), self.assertRaises(ValueError):
                browser.load_setup(self.home, self.manifest)

    def test_empty_skill_cache_uses_only_a_matching_app_marketplace_source(self):
        cached_skill = self.plugin / "skills/control-chrome/SKILL.md"
        cached_skill.unlink()
        source = self.home / ".codex/.tmp/bundled-marketplaces/openai-bundled/plugins/chrome"
        self.metadata(source, "chrome")
        skill = source / "skills/control-chrome/SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text("official skill")
        self.assertEqual(browser.load_setup(self.home, self.manifest)[3]["skill"], str(skill))
        self.assertFalse(cached_skill.exists())
        self.metadata(source, "chrome", "older")
        with self.assertRaisesRegex(ValueError, "versions differ"):
            browser.load_setup(self.home, self.manifest)

    def test_native_host_launch_does_not_depend_on_mcp_or_skill_configuration(self):
        (self.home / ".codex/config.toml").unlink()
        (self.plugin / "skills/control-chrome/SKILL.md").unlink()
        origin = self.manifest["allowed_origins"][0]
        with patch.object(browser, "read_registration", return_value=(self.home, self.manifest)), \
                patch.object(browser, "load_setup") as setup, patch.object(browser.os, "chdir"), \
                patch.object(browser.os, "execv", side_effect=SystemExit(0)) as execute, \
                patch.object(browser.sys, "argv", [str(script), origin]):
            with self.assertRaises(SystemExit) as exited:
                browser.main()
        self.assertEqual(exited.exception.code, 0)
        setup.assert_not_called()
        execute.assert_called_once_with(str(self.host), [str(self.host), origin])

    def test_unapproved_origin_is_refused_before_native_host_exec(self):
        with patch.object(browser, "read_registration", return_value=(self.home, self.manifest)), \
                patch.object(browser.os, "execv") as execute, \
                patch.object(browser.sys, "argv", [str(script), "chrome-extension://unapproved/"]):
            with self.assertRaisesRegex(ValueError, "origin"):
                browser.main()
        execute.assert_not_called()

    def test_register_is_idempotent_and_preserves_an_existing_host(self):
        browser.register_linux(self.home, self.manifest)
        destination = self.home / "NativeMessagingHosts" / (browser.HOST + ".json")
        before = destination.read_bytes()
        browser.register_linux(self.home, self.manifest)
        self.assertEqual(destination.read_bytes(), before)
        changed = {**self.manifest, "path": "/another/host"}
        destination.write_text(json.dumps(changed))
        with self.assertRaisesRegex(ValueError, "left unchanged"):
            browser.register_linux(self.home, self.manifest)
        self.assertEqual(json.loads(destination.read_text()), changed)

    def test_discovery_cannot_consume_the_protocol_input(self):
        registration = self.home / "registration.json"
        registration.write_text(json.dumps(self.manifest))
        result = json.dumps({"home": "C:/Users/ảnh ·", "manifest": "C:/ảnh/registration.json"}, ensure_ascii=False)
        with patch.object(browser.subprocess, "check_output", return_value=result) as run, \
                patch.object(browser, "wsl_path", side_effect=[self.home, registration]), \
                patch.object(browser, "load_setup", return_value="setup"):
            self.assertEqual(browser.discover()[2], "setup")
        self.assertEqual(run.call_args.kwargs["stdin"], browser.subprocess.DEVNULL)
        self.assertEqual(run.call_args.kwargs["encoding"], "utf-8")
        self.assertIn("[Console]::OutputEncoding", run.call_args.args[0][-1])

    def test_invalid_registration_output_is_refused(self):
        with patch.object(browser.subprocess, "check_output", return_value="[]"), \
                self.assertRaisesRegex(ValueError, "registration"):
            browser.read_registration()

    def test_mcp_exec_keeps_protocol_context_and_requires_explicit_kernel_exception(self):
        setup = (self.host, self.map_path("C:/runtime/node_repl.exe"), {"BROWSER": "setting"}, {})
        for flags in ([], ["--disable-sandbox"]):
            with self.subTest(flags=flags), \
                    patch.object(browser, "discover", return_value=(self.home, self.manifest, setup)), \
                    patch.object(browser.os, "chdir"), patch.object(browser.os, "execve") as execute, \
                    patch.dict(os.environ, {"CONVERSATION_CONTEXT": "retained"}), \
                    patch.object(browser.sys, "argv", [str(script), "mcp", *flags]):
                browser.main()
            command, args, env = execute.call_args.args
            self.assertEqual(args, [command, *flags])
            self.assertEqual(env["CONVERSATION_CONTEXT"], "retained")
            self.assertEqual(env["BROWSER"], "setting")

    def test_kernel_exception_is_not_a_registration_or_discovery_option(self):
        for mode in ("paths", "register-linux"):
            with self.subTest(mode=mode), \
                    patch.object(browser.sys, "argv", [str(script), mode, "--disable-sandbox"]), \
                    patch.object(browser, "discover") as discover, \
                    patch.object(browser.sys, "stderr"), self.assertRaises(SystemExit) as error:
                browser.main()
            self.assertEqual(error.exception.code, 2)
            discover.assert_not_called()

    def doctor_setup(self):
        setup = browser.load_setup(self.home, self.manifest)
        (self.home / ".codex/config.toml").write_text(
            '[mcp_servers.node_repl]\ncommand = ' + json.dumps(str(script)) + '\nargs = ["mcp"]\n'
        )
        return setup

    def test_doctor_distinguishes_optional_profiles_from_required_registration(self):
        setup = self.doctor_setup()
        profile = self.home / ".config/google-chrome"
        profile.mkdir(parents=True)
        with patch.object(browser.Path, "home", return_value=self.home), \
                patch.object(browser, "discover", return_value=(self.home, self.manifest, setup)), \
                patch.object(browser.shutil, "which", side_effect=lambda value: value), \
                patch("builtins.print") as output:
            self.assertEqual(browser.doctor(), 0)
            self.assertIn("not configured", str(output.call_args_list))
            self.assertEqual(browser.doctor(profile), 1)
            browser.register_linux(profile, self.manifest)
            self.assertEqual(browser.doctor(profile), 0)

    def test_doctor_reports_runtime_failure_and_rejects_an_unrelated_mcp_launcher(self):
        self.doctor_setup()
        (self.home / ".codex/config.toml").write_text(
            '[mcp_servers.node_repl]\ncommand = "/unrelated"\nargs = ["mcp"]\n'
        )
        with patch.object(browser.Path, "home", return_value=self.home), \
                patch.object(browser, "discover", side_effect=ValueError("stale runtime")), \
                patch.object(browser.shutil, "which", side_effect=lambda value: value), \
                patch("builtins.print") as output:
            self.assertEqual(browser.doctor(), 1)
        self.assertIn("stale runtime", str(output.call_args_list))
        self.assertIn("Codex MCP launcher", str(output.call_args_list))


if __name__ == "__main__":
    unittest.main()
