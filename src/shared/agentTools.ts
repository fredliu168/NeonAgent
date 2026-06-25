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
      name: "find_interactive_elements",
      description:
        "按文本、aria-label、title、placeholder、data-testid 等语义信息查找页面上的按钮、链接、输入框、菜单项等交互元素，并按相关度排序返回。适合先定位“提交”“保存”“下一步”这类按钮，再决定后续操作。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "要查找的目标描述或按钮文案，例如“提交”“保存草稿”“下一步”"
          },
          role: {
            type: "string",
            enum: ["any", "button", "link", "input", "menuitem", "option", "tab", "checkbox", "radio"],
            description: "可选。限制交互元素类型，默认 any"
          },
          limit: {
            type: "integer",
            description: "最多返回多少个候选，默认 8"
          },
          includeHidden: {
            type: "boolean",
            description: "是否包含不可见元素，默认 false"
          },
          exact: {
            type: "boolean",
            description: "是否优先只保留与 query 完全一致的文本/标签，默认 false"
          }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "smart_click",
      description:
        "按文本、aria-label、title、placeholder、data-testid 等语义信息自动查找最可能的交互元素并点击。会优先复用当前站点上历史成功的按钮定位记录，适合处理“点击提交/保存/下一步/登录”这类明确目标，减少反复试 CSS 选择器。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "要点击的目标描述或按钮文案，例如“提交”“保存”“继续”“登录”"
          },
          role: {
            type: "string",
            enum: ["any", "button", "link", "input", "menuitem", "option", "tab", "checkbox", "radio"],
            description: "可选。限制交互元素类型，默认 any"
          },
          index: {
            type: "integer",
            description: "在排序结果中点击第几个候选（从 0 开始），默认 0"
          },
          includeHidden: {
            type: "boolean",
            description: "是否允许匹配不可见元素，默认 false"
          },
          exact: {
            type: "boolean",
            description: "是否优先只保留与 query 完全一致的文本/标签，默认 false"
          }
        },
        required: ["query"],
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
      name: "set_checkbox",
      description: "直接设置复选框的勾选状态，并触发 input/change 事件。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "checkbox 元素的 CSS 选择器"
          },
          index: {
            type: "integer",
            description: "匹配到多个元素时的索引（从 0 开始），默认 0"
          },
          checked: {
            type: "boolean",
            description: "目标勾选状态，默认 true"
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
      name: "set_radio",
      description: "直接选中单选框，并触发 input/change 事件。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "radio 元素的 CSS 选择器"
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
      name: "hover_element",
      description:
        "悬停到页面元素上，可触发浮层、工具提示、悬浮按钮或下拉菜单。",
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
          },
          x: {
            type: "number",
            description: "悬停点横坐标；coordinateMode='css' 时为元素内 CSS 像素，ratio 时为 0 到 1 的比例"
          },
          y: {
            type: "number",
            description: "悬停点纵坐标；coordinateMode='css' 时为元素内 CSS 像素，ratio 时为 0 到 1 的比例"
          },
          coordinateMode: {
            type: "string",
            enum: ["css", "ratio"],
            description: "坐标模式：css=元素内 CSS 像素，ratio=相对比例，默认 css"
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
      name: "get_element_rect",
      description:
        "返回页面元素的位置和尺寸信息，包括 left/top/width/height/right/bottom。适合后续点击、拖动、截图定位。",
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
      name: "mouse_down",
      description:
        "在指定元素或视口坐标处按下鼠标，不自动松开。适合与 mouse_move、mouse_up 组合完成复杂拖动。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "可选。目标元素的 CSS 选择器；不传则按视口坐标定位"
          },
          index: {
            type: "integer",
            description: "匹配到多个元素时的索引（从 0 开始），默认 0"
          },
          x: {
            type: "number",
            description: "横坐标；如果传 selector，则是元素内坐标；否则是视口坐标"
          },
          y: {
            type: "number",
            description: "纵坐标；如果传 selector，则是元素内坐标；否则是视口坐标"
          },
          coordinateMode: {
            type: "string",
            enum: ["css", "ratio"],
            description: "坐标模式：css=像素，ratio=相对比例，默认 css"
          },
          button: {
            type: "integer",
            description: "鼠标按键，0=左键，1=中键，2=右键，默认 0"
          }
        },
        required: ["x", "y"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "mouse_move",
      description:
        "移动鼠标到新的位置。可传绝对坐标 x/y，也可传 deltaX/deltaY 做相对移动；若之前已 mouse_down，会保持按下状态。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "可选。目标元素的 CSS 选择器；不传则按视口坐标定位"
          },
          index: {
            type: "integer",
            description: "匹配到多个元素时的索引（从 0 开始），默认 0"
          },
          x: {
            type: "number",
            description: "绝对横坐标"
          },
          y: {
            type: "number",
            description: "绝对纵坐标"
          },
          deltaX: {
            type: "number",
            description: "相对横向位移（CSS 像素）"
          },
          deltaY: {
            type: "number",
            description: "相对纵向位移（CSS 像素）"
          },
          coordinateMode: {
            type: "string",
            enum: ["css", "ratio"],
            description: "坐标模式：css=像素，ratio=相对比例，默认 css"
          },
          button: {
            type: "integer",
            description: "未处于按下状态时使用的鼠标按键，默认 0"
          },
          buttons: {
            type: "integer",
            description: "未处于按下状态时使用的 buttons 位掩码，默认 0"
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
      name: "mouse_up",
      description:
        "在当前位置或指定位置松开鼠标。可与 mouse_down、mouse_move 组合完成跨元素拖放。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "可选。目标元素的 CSS 选择器；不传则按视口坐标定位"
          },
          index: {
            type: "integer",
            description: "匹配到多个元素时的索引（从 0 开始），默认 0"
          },
          x: {
            type: "number",
            description: "绝对横坐标"
          },
          y: {
            type: "number",
            description: "绝对纵坐标"
          },
          deltaX: {
            type: "number",
            description: "相对横向位移（CSS 像素）"
          },
          deltaY: {
            type: "number",
            description: "相对纵向位移（CSS 像素）"
          },
          coordinateMode: {
            type: "string",
            enum: ["css", "ratio"],
            description: "坐标模式：css=像素，ratio=相对比例，默认 css"
          },
          button: {
            type: "integer",
            description: "未处于按下状态时使用的鼠标按键，默认 0"
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
      name: "drag_element",
      description:
        "拖动页面上的普通 DOM 元素。可提供起点和终点，也可提供 deltaX/deltaY 做相对拖动。适合滑块、拖拽排序、拖动把手等交互测试。",
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
          },
          startX: {
            type: "number",
            description: "拖动起点横坐标；coordinateMode='css' 时为元素内 CSS 像素，ratio 时为 0 到 1 的比例。默认元素中心"
          },
          startY: {
            type: "number",
            description: "拖动起点纵坐标；coordinateMode='css' 时为元素内 CSS 像素，ratio 时为 0 到 1 的比例。默认元素中心"
          },
          endX: {
            type: "number",
            description: "拖动终点横坐标；coordinateMode='css' 时为元素内 CSS 像素，ratio 时为 0 到 1 的比例"
          },
          endY: {
            type: "number",
            description: "拖动终点纵坐标；coordinateMode='css' 时为元素内 CSS 像素，ratio 时为 0 到 1 的比例"
          },
          deltaX: {
            type: "number",
            description: "相对起点的横向位移（CSS 像素）；与 deltaY 一起可替代 endX/endY"
          },
          deltaY: {
            type: "number",
            description: "相对起点的纵向位移（CSS 像素）；与 deltaX 一起可替代 endX/endY"
          },
          coordinateMode: {
            type: "string",
            enum: ["css", "ratio"],
            description: "坐标模式：css=元素内 CSS 像素，ratio=相对比例，默认 css"
          },
          steps: {
            type: "integer",
            description: "拖动过程分成多少步，默认 12"
          },
          durationMs: {
            type: "integer",
            description: "拖动总耗时（毫秒），默认 300"
          },
          button: {
            type: "integer",
            description: "鼠标按键，0=左键，1=中键，2=右键，默认 0"
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
      name: "query_canvas",
      description:
        "查询页面上的 Canvas 元素，返回位置、CSS 尺寸和实际像素尺寸。用于确认棋盘所在的 canvas 以及点击坐标范围。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "Canvas 的 CSS 选择器，默认 'canvas'"
          },
          limit: {
            type: "integer",
            description: "最多返回的 Canvas 数量，默认 10"
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
      name: "inspect_canvas_pixel",
      description:
        "读取 Canvas 上某个点的像素颜色。支持 CSS 像素坐标或比例坐标，返回 RGBA、十六进制颜色和对应的 canvas buffer 像素位置，适合先识别棋盘状态再决定落点。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "Canvas 的 CSS 选择器，默认 'canvas'"
          },
          index: {
            type: "integer",
            description: "匹配到多个 Canvas 时的索引（从 0 开始），默认 0"
          },
          x: {
            type: "number",
            description: "横坐标；coordinateMode='css' 时为 CSS 像素，coordinateMode='ratio' 时为 0 到 1 的比例"
          },
          y: {
            type: "number",
            description: "纵坐标；coordinateMode='css' 时为 CSS 像素，coordinateMode='ratio' 时为 0 到 1 的比例"
          },
          coordinateMode: {
            type: "string",
            enum: ["css", "ratio"],
            description: "坐标模式：css=CSS 像素，ratio=相对比例，默认 css"
          }
        },
        required: ["x", "y"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "click_canvas",
      description:
        "按坐标点击 Canvas。支持 CSS 像素坐标，或 0 到 1 的相对比例坐标，适合精确点击棋盘上的棋子或格点。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "Canvas 的 CSS 选择器，默认 'canvas'"
          },
          index: {
            type: "integer",
            description: "匹配到多个 Canvas 时的索引（从 0 开始），默认 0"
          },
          x: {
            type: "number",
            description: "横坐标；coordinateMode='css' 时为 CSS 像素，coordinateMode='ratio' 时为 0 到 1 的比例"
          },
          y: {
            type: "number",
            description: "纵坐标；coordinateMode='css' 时为 CSS 像素，coordinateMode='ratio' 时为 0 到 1 的比例"
          },
          coordinateMode: {
            type: "string",
            enum: ["css", "ratio"],
            description: "坐标模式：css=CSS 像素，ratio=相对比例，默认 css"
          },
          button: {
            type: "integer",
            description: "鼠标按键，0=左键，1=中键，2=右键，默认 0"
          }
        },
        required: ["x", "y"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "drag_canvas",
      description:
        "按坐标拖动 Canvas 内的某个点到另一个点。适合普通 canvas 交互测试，例如拖动画布控件、进度把手或绘图起止点。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "Canvas 的 CSS 选择器，默认 'canvas'"
          },
          index: {
            type: "integer",
            description: "匹配到多个 Canvas 时的索引（从 0 开始），默认 0"
          },
          startX: {
            type: "number",
            description: "起点横坐标；coordinateMode='css' 时为 CSS 像素，ratio 时为 0 到 1 的比例"
          },
          startY: {
            type: "number",
            description: "起点纵坐标；coordinateMode='css' 时为 CSS 像素，ratio 时为 0 到 1 的比例"
          },
          endX: {
            type: "number",
            description: "终点横坐标；coordinateMode='css' 时为 CSS 像素，ratio 时为 0 到 1 的比例"
          },
          endY: {
            type: "number",
            description: "终点纵坐标；coordinateMode='css' 时为 CSS 像素，ratio 时为 0 到 1 的比例"
          },
          coordinateMode: {
            type: "string",
            enum: ["css", "ratio"],
            description: "坐标模式：css=CSS 像素，ratio=相对比例，默认 css"
          },
          steps: {
            type: "integer",
            description: "拖动过程分成多少步，默认 12"
          },
          durationMs: {
            type: "integer",
            description: "拖动总耗时（毫秒），默认 300"
          },
          button: {
            type: "integer",
            description: "鼠标按键，0=左键，1=中键，2=右键，默认 0"
          }
        },
        required: ["startX", "startY", "endX", "endY"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "click_canvas_cell",
      description:
        "按棋盘或网格坐标点击 Canvas 中的某个格子。支持直接传 row/col，或用 A1 这类棋盘坐标。默认按 8x8 棋盘计算格子中心。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "Canvas 的 CSS 选择器，默认 'canvas'"
          },
          index: {
            type: "integer",
            description: "匹配到多个 Canvas 时的索引（从 0 开始），默认 0"
          },
          row: {
            type: "integer",
            description: "网格行号（从 0 开始）"
          },
          col: {
            type: "integer",
            description: "网格列号（从 0 开始）"
          },
          cell: {
            type: "string",
            description: "棋盘坐标，如 A1、H8；提供后可替代 row/col"
          },
          rows: {
            type: "integer",
            description: "总行数，默认 8"
          },
          cols: {
            type: "integer",
            description: "总列数，默认 8"
          },
          origin: {
            type: "string",
            enum: ["top-left", "bottom-left"],
            description: "行号原点；bottom-left 适合国际象棋/棋盘坐标，默认 bottom-left"
          },
          paddingTop: {
            type: "number",
            description: "棋盘内容距 Canvas 顶部的内边距，默认 0"
          },
          paddingRight: {
            type: "number",
            description: "棋盘内容距 Canvas 右侧的内边距，默认 0"
          },
          paddingBottom: {
            type: "number",
            description: "棋盘内容距 Canvas 底部的内边距，默认 0"
          },
          paddingLeft: {
            type: "number",
            description: "棋盘内容距 Canvas 左侧的内边距，默认 0"
          },
          button: {
            type: "integer",
            description: "鼠标按键，0=左键，1=中键，2=右键，默认 0"
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
      name: "translate_current_page",
      description:
        "一次性翻译当前页面，效果等同翻译标签页的“翻译当前页面”按钮。使用当前翻译设置，不改变侧边栏的网页翻译开关状态。",
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
      name: "write_translation_to_page",
      description:
        "将指定译文写回原页面，默认插入到目标元素下方，并使用插件自己的隔离样式显示。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "目标元素的 CSS 选择器"
          },
          text: {
            type: "string",
            description: "要写回页面的译文内容"
          },
          index: {
            type: "integer",
            description: "匹配到多个元素时的索引（从 0 开始），默认 0"
          },
          displayMode: {
            type: "string",
            enum: ["below", "hover"],
            description: "显示模式：below=始终显示，hover=悬停原文时显示，默认 below"
          },
          position: {
            type: "string",
            enum: ["beforebegin", "afterbegin", "beforeend", "afterend"],
            description: "指定插入位置，不传则由系统根据目标元素类型自动决定最佳位置"
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
      name: "remove_translation_from_page",
      description:
        "移除插件注入到页面中的译文块。可按选择器删除某一条，也可不传 selector 直接清空当前页面全部插件译文。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "原文元素的 CSS 选择器；不传则清空所有插件插入的译文"
          },
          index: {
            type: "integer",
            description: "匹配到多个元素时的索引（从 0 开始），默认 0"
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
      name: "update_translation_on_page",
      description:
        "原地更新页面上已有的插件译文块；如果目标元素还没有对应译文，则自动创建一个新的译文块。优先用于二次润色/纠错。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "原文元素的 CSS 选择器"
          },
          text: {
            type: "string",
            description: "新的译文内容"
          },
          index: {
            type: "integer",
            description: "匹配到多个元素时的索引（从 0 开始），默认 0"
          },
          displayMode: {
            type: "string",
            enum: ["below", "hover"],
            description: "显示模式：below=始终显示，hover=悬停原文时显示；不传则保持原模式或默认 below"
          },
          position: {
            type: "string",
            enum: ["beforebegin", "afterbegin", "beforeend", "afterend"],
            description: "指定插入位置，不传则由系统根据目标元素类型自动决定最佳位置"
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
      name: "write_bilingual_translation_to_page",
      description:
        "将中英文对照翻译写回原页面，默认取目标元素文本作为原文，并把原文与译文以插件隔离样式并排或上下展示。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "目标元素的 CSS 选择器"
          },
          translatedText: {
            type: "string",
            description: "译文内容，例如中文或英文译文"
          },
          sourceText: {
            type: "string",
            description: "原文内容；不传则读取目标元素的文本"
          },
          sourceLabel: {
            type: "string",
            description: "原文标签，默认 '原文'"
          },
          targetLabel: {
            type: "string",
            description: "译文标签，默认 '译文'"
          },
          index: {
            type: "integer",
            description: "匹配到多个元素时的索引（从 0 开始），默认 0"
          },
          layout: {
            type: "string",
            enum: ["stacked", "side-by-side"],
            description: "对照布局：stacked=上下对照，side-by-side=左右对照，默认 stacked"
          },
          displayMode: {
            type: "string",
            enum: ["below", "hover"],
            description: "显示模式：below=始终显示，hover=悬停原文时显示，默认 below"
          },
          position: {
            type: "string",
            enum: ["beforebegin", "afterbegin", "beforeend", "afterend"],
            description: "指定插入位置，不传则由系统根据目标元素类型自动决定最佳位置"
          }
        },
        required: ["selector", "translatedText"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_bilingual_translation_on_page",
      description:
        "原地更新页面上已有的中英文对照翻译块；如果目标元素还没有对应翻译块，则自动创建。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "原文元素的 CSS 选择器"
          },
          translatedText: {
            type: "string",
            description: "新的译文内容"
          },
          sourceText: {
            type: "string",
            description: "新的原文内容；不传则读取目标元素的文本"
          },
          sourceLabel: {
            type: "string",
            description: "原文标签，默认 '原文'"
          },
          targetLabel: {
            type: "string",
            description: "译文标签，默认 '译文'"
          },
          index: {
            type: "integer",
            description: "匹配到多个元素时的索引（从 0 开始），默认 0"
          },
          layout: {
            type: "string",
            enum: ["stacked", "side-by-side"],
            description: "对照布局：stacked=上下对照，side-by-side=左右对照，默认 stacked"
          },
          displayMode: {
            type: "string",
            enum: ["below", "hover"],
            description: "显示模式：below=始终显示，hover=悬停原文时显示；不传则保持原模式或默认 below"
          },
          position: {
            type: "string",
            enum: ["beforebegin", "afterbegin", "beforeend", "afterend"],
            description: "指定插入位置，不传则由系统根据目标元素类型自动决定最佳位置"
          }
        },
        required: ["selector", "translatedText"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "insert_text_block",
      description:
        "在页面上指定元素的前后或内部插入一段纯文本块，可用于备注、提示或临时翻译结果。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "目标元素的 CSS 选择器"
          },
          text: {
            type: "string",
            description: "要插入的文本内容"
          },
          index: {
            type: "integer",
            description: "匹配到多个元素时的索引（从 0 开始），默认 0"
          },
          position: {
            type: "string",
            enum: ["beforebegin", "afterbegin", "beforeend", "afterend"],
            description: "插入位置，默认 afterend"
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
      name: "upload_file",
      description:
        "向 <input type='file'> 注入一个合成文件。当前支持 textContent 或 base64Content 构造文件内容，适合自动化测试上传流程。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "文件输入框的 CSS 选择器"
          },
          index: {
            type: "integer",
            description: "匹配到多个文件输入框时的索引（从 0 开始），默认 0"
          },
          fileName: {
            type: "string",
            description: "生成的文件名，默认 upload.txt"
          },
          mimeType: {
            type: "string",
            description: "MIME 类型，默认 text/plain"
          },
          textContent: {
            type: "string",
            description: "直接作为文件文本内容"
          },
          base64Content: {
            type: "string",
            description: "base64 编码的文件内容，也接受 data URL"
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
      name: "scroll_element",
      description:
        "滚动指定元素容器，可向上/下/左/右滚动指定像素，或直接滚到容器顶部/底部。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "要滚动的元素的 CSS 选择器"
          },
          index: {
            type: "integer",
            description: "匹配到多个元素时的索引（从 0 开始），默认 0"
          },
          direction: {
            type: "string",
            enum: ["up", "down", "left", "right", "top", "bottom"],
            description: "滚动方向，默认 down"
          },
          pixels: {
            type: "integer",
            description: "滚动像素数，仅 up/down/left/right 时有效，默认 300"
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
      name: "inspect_visibility_detection",
      description:
        "只读检查当前页面是否存在切屏/失焦检测线索。返回页面可见性状态、onblur/onfocus/onvisibilitychange 属性、页面文本中的切屏计数提示，以及脚本标签中的相关关键词命中；不会修改页面。",
      parameters: {
        type: "object",
        properties: {
          maxScripts: {
            type: "integer",
            description: "最多扫描的 script 标签数量，默认 80"
          },
          maxSnippetLength: {
            type: "integer",
            description: "关键词上下文片段最大长度，默认 220"
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
      name: "analyze_page_screenshot",
      description:
        "截取当前可见网页区域的截图，并用当前配置的模型做视觉识别与总结。可附加 prompt 说明识别目标，也可用 selector 提示模型关注页面中的某个元素区域。",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "告诉模型你想从截图里识别什么，例如“读取表格主要字段”或“总结这个弹窗内容”"
          },
          selector: {
            type: "string",
            description: "可选。页面元素 CSS 选择器，用作视觉焦点提示"
          },
          index: {
            type: "integer",
            description: "selector 匹配多个元素时的索引（从 0 开始），默认 0"
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
      name: "analyze_element_screenshot",
      description:
        "截取当前可见网页中的指定元素区域，并用当前模型做视觉识别。比整页截图更聚焦，适合识别弹窗、表格、卡片或局部图表。",
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
          },
          prompt: {
            type: "string",
            description: "告诉模型你想从这个元素截图里识别什么"
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
      name: "wait_for_disappear",
      description:
        "等待页面上匹配指定 CSS 选择器的元素消失。适合等 loading、弹窗、遮罩、toast 等消失后再继续操作。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "要等待消失的元素的 CSS 选择器"
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
      name: "wait_for_text",
      description:
        "等待页面或指定元素中出现某段文本。适合异步渲染、请求完成、消息提示出现后再继续操作。",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "要等待出现的文本"
          },
          selector: {
            type: "string",
            description: "可选。只在该选择器匹配元素内查找文本"
          },
          timeout: {
            type: "integer",
            description: "最长等待毫秒数，默认 5000"
          },
          exact: {
            type: "boolean",
            description: "是否要求文本完全相等，默认 false（包含匹配）"
          }
        },
        required: ["text"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "wait_for_url",
      description:
        "等待当前页面的 URL 包含指定字符串或匹配正则。用于操作后，等待页面跳转到了新的地址或路由变化完成。",
      parameters: {
        type: "object",
        properties: {
          urlPattern: {
            type: "string",
            description: "要等待的 URL 子串或正则（如 /login/i）"
          },
          timeout: {
            type: "integer",
            description: "超时时间（毫秒），默认 5000"
          }
        },
        required: ["urlPattern"],
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
      name: "extract_table",
      description:
        "读取页面表格并提取为结构化 JSON。会尽量识别表头，并按列名输出每一行记录。",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "表格的 CSS 选择器，默认 table"
          },
          index: {
            type: "integer",
            description: "匹配到多个表格时的索引（从 0 开始），默认 0"
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
      name: "get_console_logs",
      description:
        "返回插件在当前页面上下文中最近捕获到的 console 日志，以及 window error / unhandledrejection 记录，适合页面调试。",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: "最多返回多少条记录，默认 50"
          },
          level: {
            type: "string",
            enum: ["log", "info", "warn", "error"],
            description: "按 console 级别过滤"
          },
          includeErrors: {
            type: "boolean",
            description: "是否包含页面 error / unhandledrejection，默认 true"
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
      name: "list_api_traffic",
      description:
        "列出当前站点已产生的 API/接口请求流量，基于浏览器 Resource Timing 数据，可查看 fetch、XHR、beacon 等请求的 URL、耗时、传输大小、状态码等。",
      parameters: {
        type: "object",
        properties: {
          urlPattern: {
            type: "string",
            description: "按 URL 过滤，默认不过滤；支持普通子串，也支持 /pattern/flags 正则"
          },
          sinceMs: {
            type: "integer",
            description: "只返回最近多少毫秒内开始的请求；不传则返回当前页面生命周期内的请求"
          },
          limit: {
            type: "integer",
            description: "最多返回多少条，默认 50"
          },
          includeAllResources: {
            type: "boolean",
            description: "是否包含图片、脚本、CSS 等所有资源；默认 false，仅包含接口类请求或疑似 API URL"
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
      name: "analyze_api_traffic",
      description:
        "汇总分析当前站点 API/接口流量，输出请求数、总传输大小、平均/最大耗时、慢接口、流量最大的接口，并按域名、接口路径、状态码和请求类型聚合。",
      parameters: {
        type: "object",
        properties: {
          urlPattern: {
            type: "string",
            description: "按 URL 过滤，默认不过滤；支持普通子串，也支持 /pattern/flags 正则"
          },
          sinceMs: {
            type: "integer",
            description: "只分析最近多少毫秒内开始的请求；不传则分析当前页面生命周期内的请求"
          },
          topN: {
            type: "integer",
            description: "慢接口/大流量接口返回条数，默认 10"
          },
          includeAllResources: {
            type: "boolean",
            description: "是否包含图片、脚本、CSS 等所有资源；默认 false，仅包含接口类请求或疑似 API URL"
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
      name: "wait_for_api_traffic",
      description:
        "等待当前页面出现匹配条件的 API/接口请求，适合点击或输入后观察是否触发了目标接口。",
      parameters: {
        type: "object",
        properties: {
          urlPattern: {
            type: "string",
            description: "要等待的 URL 过滤条件；支持普通子串，也支持 /pattern/flags 正则"
          },
          timeout: {
            type: "integer",
            description: "最长等待毫秒数，默认 5000"
          },
          includeExisting: {
            type: "boolean",
            description: "是否先检查当前已存在的请求，默认 true"
          },
          includeAllResources: {
            type: "boolean",
            description: "是否匹配所有资源；默认 false，仅匹配接口类请求或疑似 API URL"
          }
        },
        required: ["urlPattern"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "load_tool_category",
      description: "按需加载特定领域的工具。可用领域包括：'canvas'（画布）、'translation'（页面翻译）、'traffic'（站点 API 接口流量分析）、'memory'（长期记忆）、'skill'（原生技能）、'script_skill'（脚本技能）和 'task'（定时任务）。",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["canvas", "translation", "traffic", "memory", "skill", "script_skill", "task"],
            description: "要加载的工具领域类别",
          },
        },
        required: ["category"],
        additionalProperties: false,
      },
    },
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
            items: {
              oneOf: [
                { type: "string" },
                {
                  type: "object",
                  properties: {
                    instruction: { type: "string" },
                    type: { type: "string", enum: ["instruction", "tool"] },
                    toolName: { type: "string" },
                    arguments: { type: "object" }
                  },
                  required: ["type", "toolName"]
                }
              ]
            },
            description: "按顺序排列的步骤列表。可以是自然语言指令，也可以是 {type:'tool', toolName, arguments, instruction} 结构化步骤，用于让 skill 直接控制插件工具。"
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
      name: "run_skill",
      description:
        "直接运行一个已保存技能中的结构化工具步骤，用于通过 skill 控制插件工具。字符串/自然语言步骤会作为待执行说明返回，type='tool' 的步骤会按顺序调用对应页面工具、后台工具或脚本技能工具。",
      parameters: {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            description: "要运行的技能 ID（从 list_skills 结果中获取）"
          },
          stopOnError: {
            type: "boolean",
            description: "某个工具步骤失败时是否停止，默认 true"
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
            items: {
              oneOf: [
                { type: "string" },
                {
                  type: "object",
                  properties: {
                    instruction: { type: "string" },
                    type: { type: "string", enum: ["instruction", "tool"] },
                    toolName: { type: "string" },
                    arguments: { type: "object" }
                  },
                  required: ["type", "toolName"]
                }
              ]
            },
            description: "新的步骤列表（可选）。支持字符串步骤或结构化工具步骤。"
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
  "find_interactive_elements",
  "smart_click",
  "click_element",
  "set_checkbox",
  "set_radio",
  "hover_element",
  "get_element_rect",
  "mouse_down",
  "mouse_move",
  "mouse_up",
  "drag_element",
  "query_canvas",
  "inspect_canvas_pixel",
  "click_canvas",
  "drag_canvas",
  "click_canvas_cell",
  "translate_current_page",
  "write_translation_to_page",
  "remove_translation_from_page",
  "update_translation_on_page",
  "write_bilingual_translation_to_page",
  "update_bilingual_translation_on_page",
  "insert_text_block",
  "type_text",
  "upload_file",
  "select_option",
  "scroll_page",
  "scroll_element",
  "execute_script",
  "inspect_visibility_detection",
  "wait_for_element",
  "wait_for_disappear",
  "wait_for_text",
  "extract_table",
  "get_form_data",
  "get_console_logs",
  "list_api_traffic",
  "analyze_api_traffic",
  "wait_for_api_traffic",
  "press_key"
]);

/** Tools that execute in the background service worker */
export const BACKGROUND_TOOLS = new Set([
  "navigate",
  "analyze_page_screenshot",
  "analyze_element_screenshot",
  "wait_for_url",
  "get_current_time",
  "load_tool_category",
  "save_memory", "search_memories", "delete_memory",
  "create_skill", "list_skills", "execute_skill", "run_skill", "update_skill", "delete_skill",
  "install_script_skill", "list_script_skills", "update_script_skill", "uninstall_script_skill",
  "create_scheduled_task", "list_scheduled_tasks", "update_scheduled_task", "delete_scheduled_task"
]);

export type ToolCategory = "canvas" | "translation" | "traffic" | "memory" | "skill" | "script_skill" | "task";

export const TOOL_CATEGORIES: Record<ToolCategory, string[]> = {
  canvas: ["query_canvas", "inspect_canvas_pixel", "click_canvas", "drag_canvas", "click_canvas_cell"],
  translation: ["translate_current_page", "write_translation_to_page", "remove_translation_from_page", "update_translation_on_page", "write_bilingual_translation_to_page", "update_bilingual_translation_on_page", "insert_text_block"],
  traffic: ["list_api_traffic", "analyze_api_traffic", "wait_for_api_traffic"],
  memory: ["save_memory", "search_memories", "delete_memory"],
  skill: ["create_skill", "list_skills", "execute_skill", "run_skill", "update_skill", "delete_skill"],
  script_skill: ["install_script_skill", "list_script_skills", "update_script_skill", "uninstall_script_skill"],
  task: ["create_scheduled_task", "list_scheduled_tasks", "update_scheduled_task", "delete_scheduled_task"]
};

export const CORE_TOOLS = new Set([
  "get_page_info", "read_page_content", "query_selector", "find_interactive_elements", "smart_click", "click_element",
  "set_checkbox", "set_radio", "hover_element", "get_element_rect", "mouse_down", "mouse_move", "mouse_up", "drag_element",
  "type_text", "upload_file", "wait_for_element", "wait_for_disappear", "wait_for_text", "wait_for_url", "navigate", "analyze_page_screenshot", "analyze_element_screenshot", "scroll_page", "scroll_element", "extract_table", "get_console_logs", "execute_script",
  "inspect_visibility_detection", "press_key", "get_form_data", "select_option", "get_current_time", "load_tool_category", "translate_current_page"
]);
