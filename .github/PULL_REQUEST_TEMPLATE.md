## 变更摘要

<!-- 一句话说明本 PR 做了什么、为什么。 -->

## 影响范围

- [ ] 仅文档 / 仓库治理（不影响包产物）
- [ ] 修改了 `packages/*` 中的代码
- [ ] 涉及**公共 API 面**变更（`docs/api-surface.md` 冻结快照）

## 质量门口径（修改包代码时必填）

- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 通过
- [ ] `npm test` 全绿（对应包 + 受影响包）
- [ ] 若涉及公共 API：`npm run check:api` 通过（或已同步更新 `docs/api-surface.md` 快照）
- [ ] 若涉及治理/安全逻辑：补充或更新对应单测 / E2E

## 文档与版本回写

- [ ] 用户可见改动已添加 changeset（`npm run changeset`）
- [ ] 涉及公共 API / 模块边界变更，已同步更新 `docs/`（API 快照、架构文档、CHANGELOG 同一 commit）

## 备注

<!-- 关联到 issue、设计取舍、待 reviewer 关注点等。 -->
