import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyToolName, toolKind, type AnyTool } from "../src/tools.js";

describe("classifyToolName（工具敏感分类推断）", () => {
  it("凭据类：token / apiKey / password / env", () => {
    assert.equal(classifyToolName("read_token"), "credential");
    assert.equal(classifyToolName("getApiKey"), "credential");
    assert.equal(classifyToolName("save_password"), "credential");
    assert.equal(classifyToolName("load_env"), "credential");
  });

  it("执行类：exec / shell / bash / command / spawn / run_", () => {
    assert.equal(classifyToolName("exec_script"), "exec");
    assert.equal(classifyToolName("bash"), "exec");
    assert.equal(classifyToolName("run_tests"), "exec");
    assert.equal(classifyToolName("spawn_worker"), "exec");
  });

  it("写入类：write / edit / delete / create / patch / mkdir", () => {
    assert.equal(classifyToolName("write_file"), "write");
    assert.equal(classifyToolName("edit_note"), "write");
    assert.equal(classifyToolName("delete_file"), "write");
    assert.equal(classifyToolName("create_dir"), "write");
    assert.equal(classifyToolName("mkdir"), "write");
  });

  it("只读网络类：fetch / http / request / search / api", () => {
    assert.equal(classifyToolName("http_fetch"), "network-read");
    assert.equal(classifyToolName("web_search"), "network-read");
    assert.equal(classifyToolName("download"), "network-read");
    assert.equal(classifyToolName("api_call"), "network-read");
  });

  it("无害类：内置演示工具与默认兜底", () => {
    assert.equal(classifyToolName("weather"), "harmless");
    assert.equal(classifyToolName("geocode"), "harmless");
    assert.equal(classifyToolName("exchange"), "harmless");
    assert.equal(classifyToolName("calculator"), "harmless");
    assert.equal(classifyToolName("now"), "harmless");
  });

  it("大小写不敏感", () => {
    assert.equal(classifyToolName("Write_File"), "write");
  });
});

describe("toolKind（声明优先于推断）", () => {
  const base: AnyTool = {
    name: "weird_tool",
    description: "",
    execute: () => 1,
  };

  it("未声明 meta.kind 时按名称推断", () => {
    assert.equal(toolKind(base), "harmless");
    assert.equal(toolKind({ ...base, name: "write_file" }), "write");
  });

  it("声明 meta.kind 时以声明为准", () => {
    assert.equal(toolKind({ ...base, name: "calculator", meta: { kind: "exec" } }), "exec");
  });
});
