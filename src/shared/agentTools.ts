import type { ToolDefinition } from "./agentTypes.js";

/**
 * Browser agent tools — each tool maps to a content script handler
 * or a background-level Chrome API call.
 */

export const AGENT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_page_info",
      description:
        "获取当前页面的基本信息，包括 URL、标题、meta description。用于了解当前所在页面。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_page_content",
      description:
        "读取当前页面的文本内容。可指定 CSS 选择器只读取特定区域，也可指定 maxLength 限制返回长度。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS 选择器，默认读取 body 全部文本"
          },
          maxLength: {
            type: "integer",
            description: "最大返回字符数，默认 8000"
          }
        },
        required: [],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_selector",
      description:
        "使用 CSS 选择器查询页面元素，返回匹配元素的信息列表（序号、标签、文本、关键属性）。用于查找按钮、链接、输入框等。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS 选择器"
          },
          limit: {
            type: "integer",
            description: "最多返回的元素数量，默认 20"
          }
        },
        required: ["selector"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "click_element",
      description:
        "点击页面上匹配 CSS 选择器的元素。如果有多个匹配，通过 index 指定第几个（从 0 开始）。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "目标元素的 CSS 选择器"
          },
          index: {
            type: "integer",
            description: "匹配到多个元素时的索引（从 0 开始），默认 0"
          }
        },
        required: ["selector"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "type_text",
      description:
        "在页面上的输入框或文本域中输入文字。如果 clear 为 true 则先清空原有内容。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "目标 input/textarea 的 CSS 选择器"
          },
          text: {
            type: "string",
            description: "要输入的文字"
          },
          index: {
            type: "integer",
            description: "匹配到多个元素时的索引（从 0 开始），默认 0"
          },
          clear: {
            type: "boolean",
            description: "是否先清空原有内容，默认 true"
          }
        },
        required: ["selector", "text"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "select_option",
      description:
        "在 <select> 下拉框中选择一个选项，可以通过 value 或 label（显示文字）匹配。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "<select> 元素的 CSS 选择器"
          },
          value: {
            type: "string",
            description: "选项的 value 属性值（与 label 二选一）"
          },
          label: {
            type: "string",
            description: "选项的显示文字（与 value 二选一）"
          },
          index: {
            type: "integer",
            description: "匹配到多个 select 时的索引，默认 0"
          }
        },
        required: ["selector"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "scroll_page",
      description:
        "滚动页面。可向上/向下滚动指定像素，或滚动到页顶/页底，或滚动到指定元素的位置。",
      parameters: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["up", "down", "top", "bottom"],
            description: "滚动方向（若提供 selector 则忽略）"
          },
          pixels: {
            type: "integer",
            description: "滚动像素数，仅 up/down 时有效，默认 500"
          },
          selector: {
            type: "string",
            description: "滚动到该选择器匹配元素的位置"
          }
        },
        required: [],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "execute_script",
      description:
        "在页面上执行一段 JavaScript 代码并返回执行结果。非常强大，可以完成其他工具无法完成的复杂操作。代码在页面的上下文中执行。",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "要执行的 JavaScript 代码"
          }
        },
        required: ["code"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "navigate",
      description: "让浏览器导航到指定 URL。导航后需要等待页面加载完成。",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "目标 URL"
          }
        },
        required: ["url"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "wait_for_element",
      description:
        "等待页面上出现匹配指定 CSS 选择器的元素。用于页面加载或动态内容出现后再操作。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "要等待的元素的 CSS 选择器"
          },
          timeout: {
            type: "integer",
            description: "最长等待毫秒数，默认 5000"
          }
        },
        required: ["selector"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_form_data",
      description:
        "获取页面上表单中所有输入字段的当前值。可指定表单选择器，默认获取页面上第一个表单。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "表单的 CSS 选择器，默认 'form'"
          }
        },
        required: [],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "press_key",
      description: "模拟键盘按键，如 Enter、Escape、Tab 等。",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "按键名称，如 'Enter', 'Escape', 'Tab', 'ArrowDown' 等"
          },
          selector: {
            type: "string",
            description: "目标元素的 CSS 选择器，默认为当前焦点元素"
          }
        },
        required: ["key"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "save_memory",
      description:
        "将重要信息保存到持久记忆中。用于记住用户偏好、学到的知识、网站特征、操作经验等，下次对话时仍可使用。",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "要保存的记忆内容，用简洁的一句话描述"
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "标签列表，用于分类和检索，如 ['用户偏好', '网站特征']"
          }
        },
        required: ["content"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_memories",
      description:
        "搜索已保存的记忆。可通过关键词查找相关记忆条目，不传 query 则返回全部记忆。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词，空字符串返回全部记忆"
          }
        },
        required: [],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_memory",
      description:
        "删除一条已保存的记忆。需要提供记忆的 ID（从 search_memories 结果中获取）。",
      parameters: {
        type: "object",
        properties: {
          memoryId: {
            type: "string",
            description: "要删除的记忆条目 ID"
          }
        },
        required: ["memoryId"],
        additionalProperties: false
      }
    }
  },
  // ── Skill Tools ──
  {
    type: "function",
    function: {
      name: "create_skill",
      description:
        "将一组操作步骤保存为可复用的技能。当你成功完成一个多步骤任务后，可以将其保存为技能，下次遇到类似任务时直接调用。",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "技能名称，简洁描述该技能的用途，如 '自动登录教务系统'"
          },
          description: {
            type: "string",
            description: "技能的详细描述，说明适用场景和预期效果"
          },
          steps: {
            type: "array",
            items: { type: "string" },
            description: "按顺序排列的步骤列表，每步是一条自然语言指令"
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "标签列表，用于分类和检索，如 ['自动化', '登录']"
          }
        },
        required: ["name", "description", "steps"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_skills",
      description:
        "列出已保存的技能。可通过关键词搜索，不传 query 则返回全部技能。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词，为空则返回全部技能"
          }
        },
        required: [],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "execute_skill",
      description:
        "执行一个已保存的技能。会加载技能的步骤列表，你需要按步骤使用工具逐一执行。执行后会自动记录使用次数。",
      parameters: {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            description: "要执行的技能 ID（从 list_skills 结果中获取）"
          }
        },
        required: ["skillId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_skill",
      description:
        "升级/更新一个已保存的技能。当你发现更好的操作方式时，可以更新技能的步骤或描述。版本号会自动递增。",
      parameters: {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            description: "要更新的技能 ID"
          },
          name: {
            type: "string",
            description: "新的技能名称（可选）"
          },
          description: {
            type: "string",
            description: "新的技能描述（可选）"
          },
          steps: {
            type: "array",
            items: { type: "string" },
            description: "新的步骤列表（可选）"
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "新的标签列表（可选）"
          }
        },
        required: ["skillId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_skill",
      description:
        "删除一个已保存的技能。需要提供技能的 ID（从 list_skills 结果中获取）。",
      parameters: {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            description: "要删除的技能 ID"
          }
        },
        required: ["skillId"],
        additionalProperties: false
      }
    }
  },
  // ── Script Skill Tools ──
  {
    type: "function",
    function: {
      name: "get_current_time",
      description:
        "获取当前的日期和时间信息，包括完整的日期时间字符串、时间戳、星期几、时区等。无需参数。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false
      }
    }
  },
  // ── Script Skill Tools ──
  {
    type: "function",
    function: {
      name: "install_script_skill",
      description:
        "安装一个脚本技能。需要提供技能的名称、描述、JavaScript 代码和工具定义。脚本技能可以为智能体提供额外的工具能力（如调用外部 API）。代码格式为 CommonJS 风格，使用 exports.tool_name = async function(args, env) { ... } 导出工具函数。",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "技能名称，如 'weather-pollen'"
          },
          description: {
            type: "string",
            description: "技能的详细描述"
          },
          code: {
            type: "string",
            description: "JavaScript 代码，使用 exports.toolName = async function(args, env) { ... } 格式导出工具函数"
          },
          tools: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "工具名称" },
                description: { type: "string", description: "工具描述" },
                parameters: { type: "object", description: "工具参数的 JSON Schema" }
              },
              required: ["name", "description", "parameters"]
            },
            description: "该技能提供的工具定义列表"
          },
          envVars: {
            type: "object",
            description: "环境变量/配置，如 { \"API_KEY\": \"xxx\" }"
          },
          sourceUrl: {
            type: "string",
            description: "技能来源 URL（可选）"
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "标签列表"
          }
        },
        required: ["name", "description", "code", "tools"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_script_skills",
      description:
        "列出已安装的脚本技能。可通过关键词搜索，不传 query 则返回全部。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词，为空则返回全部脚本技能"
          }
        },
        required: [],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_script_skill",
      description:
        "更新一个已安装的脚本技能的代码、工具定义或环境变量。",
      parameters: {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            description: "脚本技能 ID"
          },
          name: { type: "string", description: "新名称（可选）" },
          description: { type: "string", description: "新描述（可选）" },
          code: { type: "string", description: "新代码（可选）" },
          tools: {
            type: "array",
            items: { type: "object" },
            description: "新工具定义列表（可选）"
          },
          envVars: { type: "object", description: "新环境变量（可选）" },
          tags: { type: "array", items: { type: "string" }, description: "新标签（可选）" }
        },
        required: ["skillId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "uninstall_script_skill",
      description:
        "卸载一个脚本技能。需要提供技能 ID（从 list_script_skills 结果中获取）。",
      parameters: {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            description: "要卸载的脚本技能 ID"
          }
        },
        required: ["skillId"],
        additionalProperties: false
      }
    }
  },
  // ── Scheduled Task Tools ──
  {
    type: "function",
    function: {
      name: "create_scheduled_task",
      description:
        "创建一个定时任务。任务会按照指定的时间计划自动触发智能体执行指令。支持四种调度类型：once（单次执行）、interval（固定间隔）、daily（每天定时）、weekly（每周定时）。",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "任务名称，简洁描述用途，如 '每日签到'、'定时检查库存'"
          },
          instruction: {
            type: "string",
            description: "智能体执行的指令，与直接发送给智能体的消息一样"
          },
          scheduleType: {
            type: "string",
            enum: ["once", "interval", "daily", "weekly"],
            description: "调度类型：once=单次, interval=固定间隔, daily=每天, weekly=每周"
          },
          time: {
            type: "string",
            description: "执行时间。once 用 ISO 格式如 '2025-01-15T09:00:00'；daily/weekly 用 HH:mm 如 '09:30'；interval 可忽略"
          },
          dayOfWeek: {
            type: "integer",
            description: "weekly 类型时指定星期几：0=周日, 1=周一, ..., 6=周六"
          },
          intervalMinutes: {
            type: "integer",
            description: "interval 类型时的间隔分钟数（≥1）"
          }
        },
        required: ["name", "instruction", "scheduleType", "time"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_scheduled_tasks",
      description:
        "列出所有定时任务。可通过关键词搜索，不传 query 则返回全部任务。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词，为空则返回全部任务"
          }
        },
        required: [],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_scheduled_task",
      description:
        "更新一个定时任务的属性（名称、指令、调度计划、启用/禁用等）。",
      parameters: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "要更新的任务 ID"
          },
          name: { type: "string", description: "新的任务名称（可选）" },
          instruction: { type: "string", description: "新的执行指令（可选）" },
          scheduleType: {
            type: "string",
            enum: ["once", "interval", "daily", "weekly"],
            description: "新的调度类型（可选）"
          },
          time: { type: "string", description: "新的执行时间（可选）" },
          dayOfWeek: { type: "integer", description: "新的星期几（可选）" },
          intervalMinutes: { type: "integer", description: "新的间隔分钟数（可选）" },
          enabled: { type: "boolean", description: "是否启用任务" }
        },
        required: ["taskId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_scheduled_task",
      description:
        "删除一个定时任务。需要提供任务 ID（从 list_scheduled_tasks 结果中获取）。",
      parameters: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "要删除的任务 ID"
          }
        },
        required: ["taskId"],
        additionalProperties: false
      }
    }
  }
];

/** Get tool definitions as a lookup map */
export function getToolByName(name: string): ToolDefinition | undefined {
  return AGENT_TOOL_DEFINITIONS.find((t) => t.function.name === name);
}

/** Tools that execute on the content script (page context) */
export const PAGE_TOOLS = new Set([
  "get_page_info",
  "read_page_content",
  "query_selector",
  "click_element",
  "type_text",
  "select_option",
  "scroll_page",
  "execute_script",
  "wait_for_element",
  "get_form_data",
  "press_key"
]);

/** Tools that execute in the background service worker */
export const BACKGROUND_TOOLS = new Set([
  "navigate",
  "get_current_time",
  "save_memory", "search_memories", "delete_memory",
  "create_skill", "list_skills", "execute_skill", "update_skill", "delete_skill",
  "install_script_skill", "list_script_skills", "update_script_skill", "uninstall_script_skill",
  "create_scheduled_task", "list_scheduled_tasks", "update_scheduled_task", "delete_scheduled_task"
]);
