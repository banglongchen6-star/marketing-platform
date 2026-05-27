# media-workbench 项目规范

## 项目概述

品宣运营工作台 V11 - 企业内部运营管理工具，提供排期管理、数据统计、登录认证等功能的单页 Web 应用。

## 技术栈

- **前端**: 原生 HTML/CSS/JavaScript（无框架）
- **依赖库**: Chart.js (图表), SheetJS/xlsx (Excel 处理), Google Fonts (Noto Sans SC)
- **服务**: Python 3.12 内置 HTTP 服务器（静态文件服务）

## 目录结构

```
/workspace/projects/extracted/media-workbench/
├── index.html          # 主入口（283KB，内嵌样式和脚本）
├── css/
│   └── schedule.css     # 样式文件
├── js/                 # JS 模块目录
├── scripts/            # Coze 部署脚本
│   ├── coze-preview-build.sh
│   ├── coze-preview-run.sh
│   ├── coze-deploy-build.sh
│   └── coze-deploy-run.sh
├── test-*.html         # 测试页面
└── *.md                # 文档
```

## 运行与预览

### 预览
```bash
# 构建验证
bash extracted/media-workbench/scripts/coze-preview-build.sh

# 启动预览服务（5000 端口）
bash extracted/media-workbench/scripts/coze-preview-run.sh
```

### 部署
```bash
# 构建
bash extracted/media-workbench/scripts/coze-deploy-build.sh

# 运行
bash extracted/media-workbench/scripts/coze-deploy-run.sh
```

## 项目配置

| 字段 | 值 |
|------|-----|
| `project_type` | web |
| `runtime` | python-3.12 |
| `service_port` | 5000 |
| `deploy_kind` | service |
| `deploy_flavor` | web |

## 关键入口

- **预览入口**: `/workspace/projects/.coze` → `[dev]`
- **部署入口**: `/workspace/projects/.coze` → `[deploy]`
- **子项目配置**: `/workspace/projects/extracted/media-workbench/.coze`

## 长期约束

1. **静态项目**: 无需构建步骤，直接通过 Python 静态服务器提供服务
2. **端口固定**: HTTP 服务统一使用 5000 端口
3. **子项目分离**: 技术项目位于子目录 `extracted/media-workbench/`，根 `.coze` 通过相对路径调用子项目脚本
4. **幂等性**: 启动脚本会自动清理端口残留进程，支持重复执行

## 常见问题和预防

- **预览无法访问**: 确认 5000 端口未被占用，服务已启动
- **脚本执行失败**: 检查脚本是否有执行权限（chmod +x）
