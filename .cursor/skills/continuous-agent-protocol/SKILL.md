---
name: continuous-agent-protocol
description: >-
  Runs Cursor Agent in a non-interrupting execution mode for long implementation
  tasks—reducing mid-task “phase summary” stops until the project is runnable and
  acceptable. Use when the user enables autonomous run, pastes an execution
  protocol, says 继续执行/不切换问答模式/不要中断/连续执行, or reports the agent
  keeps stopping or breaking flow between subtasks.
disable-model-invocation: true
---

# Continuous agent execution protocol

## When this skill applies

Use this skill only after the user **explicitly** opts in (for example by @mentioning this skill, or by sending the **User activation block** below). Do not assume this mode for casual Q&A.

## Priority

While this skill is active, it **overrides** conflicting interaction habits (for example default “phase updates” after each subtask) and overrides other rules that say to pause for questions—**except** where safety or system policy forbids continuation.

## Instructions for the agent

1. Treat the **entire project** as one task until it is **runnable and acceptable** for handoff.
2. After each change: run **self-check** (lint and any verification the task requires), then **immediately** start the **next** subtask. Do not wait for user confirmation.
3. Do not stop for subjective reasons. The only user-controlled stops are **`暂停执行`** and **`汇报进度`** (see below).
4. If the user sends a **question**, treat it by default as **notes**, not a request to enter Q&A or status reporting—**keep executing** unless the question is also an explicit **暂停执行** or **汇报进度**.
5. **External blockers only** (insufficient permissions, missing files, commands failing without recovery): you may reply, using **exactly** this template:

   ```text
   阻塞原因：
   已尝试解决：
   需要我提供的唯一输入：
   ```

6. Messages other than **`暂停执行`** or **`汇报进度`** do **not** change execution state.
7. Only when the user sends **`汇报进度`**, output: **changed file paths** + **key changes** + **verification results**.

## Optional adjustment (only if the user requests it)

If the user wants questions answered **and** continuous execution, replace instruction 4 with: when the user sends a question, **answer briefly**, then **immediately** resume the next subtask without asking whether to continue.

## User activation block (verbatim)

If the user has not sent this yet, they can paste the following to enable the protocol:

```text
继续执行，不切换问答模式。

从现在起，执行协议如下（唯一最高优先级）：
1) 把整个项目视为唯一任务，直到“可运行、可验收”才算完成。
2) 连续执行：每次改动后必须先自检（lint/必要验证），随后立即进入下一子任务，不等待我确认。
3) 除非我发送“暂停执行”，否则你不得因任何主观原因中断。
4) 即使我发送疑问句，也默认视为“记录意见”，不进入解释/汇报，直接继续执行。
5) 仅当出现外部阻塞（权限不足/文件缺失/命令失败且无法自行恢复）时，才允许回复，且必须严格使用以下格式：
   阻塞原因：
   已尝试解决：
   需要我提供的唯一输入：
6) 除“暂停执行”或“汇报进度”外，其他消息不改变执行状态。
7) 只有当我发送“汇报进度”时，你才输出：已改文件路径 + 关键变更 + 校验结果。
```

## Sharing this skill

Copy the directory `continuous-agent-protocol/` (containing this `SKILL.md`) into:

- **Personal (all projects):** `~/.cursor/skills/continuous-agent-protocol/`
- **Single project (teammates via git):** `<repo>/.cursor/skills/continuous-agent-protocol/`
