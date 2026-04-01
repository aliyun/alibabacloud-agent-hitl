# 阿里云 Agent HITL

[English](./README.md)

阿里云 Agent 集成的人机协同（HITL）解决方案，为 AI 驱动的云操作提供风险检测和人工审批工作流。

## 子包

| 包名 | 描述 |
|------|------|
| [@alicloud/alibabacloud-hitl-claw-plugin](./packages/alibabacloud-hitl-claw-plugin) | OpenClaw 人机协同审批插件 |

## 概述

本 Monorepo 包含面向多个 AI Agent 平台的 HITL（Human-in-the-Loop）实现。HITL 确保高风险的阿里云 CLI 操作在执行前需获得明确的人工审批。

### 核心特性

- **风险检测**：集成阿里云 IMS 进行实时风险评估
- **人工审批**：高风险操作需通过安全链接进行明确审批
- **多渠道支持**：支持钉钉、飞书及原生控制台界面
- **可扩展**：设计支持多种 Agent 平台

## 快速开始

请查看各子包文档：

- [OpenClaw 插件文档](./packages/alibabacloud-hitl-claw-plugin/README.zh-CN.md)


## 许可证

MIT
