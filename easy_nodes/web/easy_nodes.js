import { app } from '../../scripts/app.js'
import { api } from '../../scripts/api.js'
import { ComfyWidgets } from "../../scripts/widgets.js";
import { createSetting } from "./config_service.js";


const sourcePathPrefixId = "easy_nodes.SourcePathPrefix";
const editorPathPrefixId = "easy_nodes.EditorPathPrefix";
const reloadOnEditId = "easy_nodes.ReloadOnEdit";
const renderIconsId = "easy_nodes.RenderIcons";


function resizeShowValueWidgets(node, numValues, app) {
  const numShowValueWidgets = (node.showValueWidgets?.length ?? 0);
  numValues = Math.max(numValues, 0);

  if (numValues > numShowValueWidgets) {
    for (let i = numShowValueWidgets; i < numValues; i++) {
      const showValueWidget = ComfyWidgets["STRING"](node, `output${i}`, ["STRING", { multiline: true }], app).widget;
      showValueWidget.inputEl.readOnly = true;
      if (!node.showValueWidgets) {
        node.showValueWidgets = [];
      }
      node.showValueWidgets.push(showValueWidget);
    }
  } else if (numValues < numShowValueWidgets) {
    const removedWidgets = node.showValueWidgets.splice(numValues);
    node.widgets.splice(node.origWidgetCount + numValues);

    // Remove the detached widgets from the DOM
    removedWidgets.forEach(widget => {
      widget.inputEl.parentNode.removeChild(widget.inputEl);
    });
  }
}

const startOffset = 10;

function renderSourceLinkAndInfo(node, ctx, titleHeight) {
  if (node?.flags?.collapsed) {
    return;
  }

  let currentX = node.size[0] - startOffset;
  if (node.sourceLoc) {
    node.link = node.sourceLoc;

    const linkText = "src";
    ctx.fillStyle = "#2277FF";
    node.linkWidth = ctx.measureText(linkText).width;
    currentX -= node.linkWidth;
    ctx.fillText(
      linkText,
      currentX,
      LiteGraph.NODE_TITLE_TEXT_Y - titleHeight
    );
  }

  if (node.description?.trim()) {
    const infoText = "  ℹ️  ";
    node.infoWidth = ctx.measureText(infoText).width;
    currentX -= node.infoWidth;
    ctx.fillText(infoText, currentX, LiteGraph.NODE_TITLE_TEXT_Y - titleHeight);
  } else {
    node.infoWidth = 0;
  }

  if (node?.has_log) {
    const logText = "📜";
    node.logWidth = ctx.measureText(logText).width;
    currentX -= node.logWidth;
    ctx.fillText(logText, currentX, LiteGraph.NODE_TITLE_TEXT_Y - titleHeight);
  } else {
    node.logWidth = 0;
  }
}

function isInsideRectangle(x, y, left, top, width, height) {
  if (left < x && left + width > x && top < y && top + height > y) {
    return true;
  }
  return false;
}

class FloatingLogWindow {
  constructor() {
    this.window = null;
    this.content = null;
    this.currentNodeId = null;
    this.hideTimeout = null;
  }

  create() {
    if (this.window) return;

    this.window = document.createElement('div');
    this.window.className = 'floating-log-window';
    this.window.style.cssText = `
      position: absolute;
      width: 400px;
      height: 300px;
      background-color: #1e1e1e;
      border: 1px solid #444;
      border-radius: 5px;
      padding: 10px;
      box-shadow: 0 0 10px rgba(0,0,0,0.5);
      z-index: 1000;
      display: none;
      overflow: hidden;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    `;

    const title = document.createElement('h3');
    title.textContent = 'Node Log';
    title.style.margin = '0';

    header.appendChild(title);

    this.content = document.createElement('pre');
    this.content.style.cssText = `
      height: calc(100% - 30px);
      overflow-y: auto;
      margin: 0;
      padding: 5px;
      background-color: #252525;
      color: #e0e0e0;
      font-family: monospace;
      white-space: pre-wrap;
      word-wrap: break-word;
    `;

    this.window.appendChild(header);
    this.window.appendChild(this.content);
    document.body.appendChild(this.window);

    // Add event listeners to prevent hiding when hovering over the log window
    this.window.addEventListener('mouseenter', () => {
      if (this.hideTimeout) {
        clearTimeout(this.hideTimeout);
        this.hideTimeout = null;
      }
    });

    this.window.addEventListener('mouseleave', () => {
      this.scheduleHide();
    });
  }

  show(x, y, nodeId) {
    if (!this.window) this.create();
    this.window.style.display = 'block';
    this.window.style.left = `${x}px`;
    this.window.style.top = `${y}px`;
    
    if (this.currentNodeId !== nodeId) {
      this.currentNodeId = nodeId;
      this.content.textContent = ''; // Clear previous content
      this.streamLog();
    }

    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  scheduleHide() {
    this.hideTimeout = setTimeout(() => this.hide(), 300); // Hide after 300ms
  }

  hide() {
    if (this.window) {
      this.window.style.display = 'none';
      this.currentNodeId = null;
    }
  }

  async streamLog() {
    if (!this.currentNodeId) return;

    const response = await api.fetchApi(`/easy_nodes/show_log?node=${this.currentNodeId}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      this.content.textContent += text;
      this.content.scrollTop = this.content.scrollHeight;
    }
  }
}

const floatingLogWindow = new FloatingLogWindow();


app.registerExtension({
  name: "EasyNodes",
  async setup() {
    createSetting(
      editorPathPrefixId,
      "🪄 Stack trace link prefix (makes stack traces clickable, e.g. 'vscode://vscode-remote/wsl+Ubuntu')",
      "text",
      ""
    );
    createSetting(
      sourcePathPrefixId,
      "🪄 Stack trace remove prefix (common prefix to remove, e.g '/home/user/project/')",
      "text",
      ""
    );
    createSetting(
      reloadOnEditId,
      "🪄 Auto-reload EasyNodes source files on edits.",
      "boolean",
      false,
    );
    createSetting(
      renderIconsId,
      "🪄 Render src, log, and info icons in node titlebars. If false, can still be accessed via menu.",
      "boolean",
      true,
    );
  },

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    const easyNodesJsonPrefix = "EasyNodesInfo=";
    if (nodeData?.description?.startsWith(easyNodesJsonPrefix)) {
      // EasyNodes metadata will be crammed into the first line of the description in json format.
      const [nodeInfo, ...descriptionLines] = nodeData.description.split('\n');
      const { color, bgColor, width, height, sourceLocation } = JSON.parse(nodeInfo.replace(easyNodesJsonPrefix, ""));

      nodeData.description = descriptionLines.join('\n');

      const editorPathPrefix = app.ui.settings.getSettingValue(editorPathPrefixId);

      function applyColorsAndSource() {
        if (color) {
          this.color = color;
        }
        if (bgColor) {
          this.bgcolor = bgColor;
        }
        if (sourceLocation && editorPathPrefix) {
          this.sourceLoc = editorPathPrefix + sourceLocation;
        }
        this.description = nodeData.description;
      }

      // Apply colors and source location when the node is created
      const onNodeCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        onNodeCreated?.apply(this, arguments);
        applyColorsAndSource.call(this);
        if (width) {
          this.size[0] = width;
        }
        if (height) {
          this.size[1] = height;
        }
        this.origWidgetCount = this.widgets?.length ?? 0;
        this.linkWidth = 20;
      };

      // Apply colors and source location when configuring the node
      const onConfigure = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function () {
        onConfigure?.apply(this, arguments);
        applyColorsAndSource.call(this);

        this.origWidgetCount = this.widgets?.length ?? 0;
        const widgetValsLength = this.widgets_values?.length ?? 0;

        const numShowVals = widgetValsLength - this.origWidgetCount;
        resizeShowValueWidgets(this, numShowVals, app);

        for (let i = 0; i < numShowVals; i++) {
          this.showValueWidgets[i].value = this.widgets_values[this.origWidgetCount + i];
        }
      };

      const onExecuted = nodeType.prototype.onExecuted;
      nodeType.prototype.onExecuted = function (message) {
        onExecuted?.apply(this, [message]);

        if (!message || !message.text) {
          return;
        }

        const numShowVals = message.text.length;

        resizeShowValueWidgets(this, numShowVals, app);

        for (let i = 0; i < numShowVals; i++) {
          this.showValueWidgets[i].value = message.text[i];
        }

        this.setSize(this.computeSize());
        this.setDirtyCanvas(true, true);
        app.graph.setDirtyCanvas(true, true);
      }

      const onDrawForeground = nodeType.prototype.onDrawForeground;
      nodeType.prototype.onDrawForeground = function (ctx, canvas, graphMouse) {
        onDrawForeground?.apply(this, arguments);
        if (app.ui.settings.getSettingValue(renderIconsId)) {
          renderSourceLinkAndInfo(this, ctx, LiteGraph.NODE_TITLE_HEIGHT); 
        }
      };

      const onDrawBackground = nodeType.prototype.onDrawBackground;
      nodeType.prototype.onDrawBackground = function (ctx, canvas) {
        onDrawBackground?.apply(this, arguments);
      }

      const onMouseDown = nodeType.prototype.onMouseDown;
      nodeType.prototype.onMouseDown = function (e, localPos, graphMouse) {
        onMouseDown?.apply(this, arguments);

        if (!app.ui.settings.getSettingValue(renderIconsId)) {
          return;
        }

        if (this.link && !this.flags.collapsed && isInsideRectangle(localPos[0], localPos[1], this.size[0] - this.linkWidth - startOffset,
          -LiteGraph.NODE_TITLE_HEIGHT, this.linkWidth, LiteGraph.NODE_TITLE_HEIGHT)) {
          window.open(this.link, "_blank");
          return true;
        }

        const leftPos = this.size[0] - this.linkWidth - this.logWidth - this.infoWidth - startOffset;
        
        // Check if log icon is clicked
        if (this?.has_log && !this.flags.collapsed && isInsideRectangle(localPos[0], localPos[1], leftPos,
          -LiteGraph.NODE_TITLE_HEIGHT, this.logWidth, LiteGraph.NODE_TITLE_HEIGHT)) {
          window.open(`/easy_nodes/show_log?node=${this.id}`, "_blank");
          return true;
        }
      };

      const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
      nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
        getExtraMenuOptions?.apply(this, arguments);

        if (this.sourceLoc) {
          options.push({
            content: "Open Source",
            callback: () => {
              window.open(this.sourceLoc, "_blank");
            }
          });
        }

        if (this.has_log) {
          options.push({
            content: "View Log",
            callback: () => {
              window.open(`/easy_nodes/show_log?node=${this.id}`, "_blank");
            }
          });
        }

        return options;
      };
    }
  },
});


const origProcessMouseMove = LGraphCanvas.prototype.processMouseMove;
LGraphCanvas.prototype.processMouseMove = function(e) {
  const res = origProcessMouseMove.apply(this, arguments);

  if (!app.ui.settings.getSettingValue(renderIconsId)) {
    return res;
  }

  var node = this.graph.getNodeOnPos(e.canvasX,e.canvasY,this.visible_nodes);

  if (!node || !this.canvas || node.flags.collapsed) {
    return res;
  }

  var linkWidth = node?.linkWidth ?? 0;
  var linkHeight = LiteGraph.NODE_TITLE_HEIGHT;

  var infoWidth = node?.infoWidth ?? 0;
  var logWidth = node?.logWidth ?? 0;

  var linkX = node.pos[0] + node.size[0] - linkWidth - startOffset;
  var linkY = node.pos[1] - LiteGraph.NODE_TITLE_HEIGHT;

  var infoX = linkX - infoWidth;
  var infoY = linkY;

  var logX = infoX - logWidth;
  var logY = linkY;

  const desc = node.description?.trim();
  if (node.link && isInsideRectangle(e.canvasX, e.canvasY, linkX, linkY, linkWidth, linkHeight)) {
      this.canvas.style.cursor = "pointer";
      this.tooltip_text = node.link;
      this.tooltip_pos = [e.canvasX, e.canvasY];
      this.dirty_canvas = true;
  } else if (desc && isInsideRectangle(e.canvasX, e.canvasY, infoX, infoY, infoWidth, linkHeight)) {
      this.canvas.style.cursor = "help";
      this.tooltip_text = desc;
      this.tooltip_pos = [e.canvasX, e.canvasY];
      this.dirty_canvas = true;
  } else if (node?.has_log && isInsideRectangle(e.canvasX, e.canvasY, logX, logY, logWidth, linkHeight)) {
      this.canvas.style.cursor = "pointer";
      this.tooltip_text = "View Log";
      this.tooltip_pos = [e.canvasX, e.canvasY];
      this.dirty_canvas = true;
      
      floatingLogWindow.show(e.canvasX, e.canvasY, node.id);
  } else {
      this.tooltip_text = null;
      floatingLogWindow.scheduleHide();
  }

  return res;
};


LGraphCanvas.prototype.drawNodeTooltip = function(ctx, text, pos) {
    if (text === null) return;
            
    ctx.save();
    ctx.font = "14px Consolas, 'Courier New', monospace";
    
    var lines = text.split('\n');
    var lineHeight = 18;
    var totalHeight = lines.length * lineHeight;
    
    var w = 0;
    for (var i = 0; i < lines.length; i++) {
        var info = ctx.measureText(lines[i].trim());
        w = Math.max(w, info.width);
    }
    w += 20;
    
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.shadowBlur = 5;
    
    ctx.fillStyle = "#2E2E2E";
    ctx.beginPath();
    ctx.roundRect(pos[0] - w / 2, pos[1] - 15 - totalHeight, w, totalHeight, 5, 5);
    ctx.moveTo(pos[0] - 10, pos[1] - 15);
    ctx.lineTo(pos[0] + 10, pos[1] - 15);
    ctx.lineTo(pos[0], pos[1] - 5);
    ctx.fill();
    
    ctx.shadowColor = "transparent";
    ctx.textAlign = "left";
    
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        
        // Render the colored line
        var el = document.createElement('div');
        
        el.innerHTML = line;
        
        var parts = el.childNodes;
        var x = pos[0] - w / 2 + 10;
        
        for (var j = 0; j < parts.length; j++) {
            var part = parts[j];
            ctx.fillStyle = "#E4E4E4";
            ctx.fillText(part.textContent, x, pos[1] - 15 - totalHeight + (i + 0.8) * lineHeight);
            x += ctx.measureText(part.textContent).width;
        }
    }
    
    ctx.restore();
};


const origdrawFrontCanvas = LGraphCanvas.prototype.drawFrontCanvas;
LGraphCanvas.prototype.drawFrontCanvas = function() {
  origdrawFrontCanvas.apply(this, arguments);
  if (this.tooltip_text) {
    this.ctx.save();
    this.ds.toCanvasContext(this.ctx);
    this.drawNodeTooltip(this.ctx, this.tooltip_text, this.tooltip_pos);
    this.ctx.restore();
  }  
};


const formatExecutionError = function(error) {
  if (error == null) {
    return "(unknown error)";
  }

  // Joining the traceback if it's an array, or directly using it if it's already a string
  let traceback = Array.isArray(error.traceback) ? error.traceback.join("") : error.traceback;
  let exceptionMessage = error.exception_message;

  const nodeId = error.node_id;
  const nodeType = error.node_type;

  // Regular expression to match "File _, in_ " patterns
  const fileLineRegex = /File "(.+)", line (\d+), in .+/g;

  // Replace "File _, in_ " patterns with "<path>:<line>"
  traceback = traceback.replace(fileLineRegex, "$1:$2");
  exceptionMessage = exceptionMessage.replace(fileLineRegex, "$1:$2");

  const editorPathPrefix = this.ui.settings.getSettingValue(editorPathPrefixId);
  const filePathPrefix = this.ui.settings.getSettingValue(sourcePathPrefixId);

  let formattedExceptionMessage = exceptionMessage;
  let formattedTraceback = traceback;

  if (editorPathPrefix) {
    // Escape special characters in filePathPrefix to be used in a regular expression
    const escapedPathPrefix = filePathPrefix ? filePathPrefix.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') : "";

    // Creating the regular expression using RegExp constructor to match file paths
    const filePathRegex = new RegExp(`(${escapedPathPrefix || "/"})(.*?):(\\d+)`, 'g');

    // Replace "<path>:<line>" patterns with links in the exception message
    formattedExceptionMessage = exceptionMessage.replace(filePathRegex, (match, prefix, p1, p2) => {
        const displayPath = filePathPrefix ? p1 : `${prefix}${p1}`;
        return `<a href="${editorPathPrefix}${prefix}${p1}:${p2}" style="color:orange">${displayPath}:${p2}</a>`;
      });

    // Check if the exception message contains "<path>:<line>" matches
    const hasFileLineMatches = filePathRegex.test(exceptionMessage);

    if (!hasFileLineMatches) {
      // Replace "<path>:<line>" patterns with links in the traceback
      formattedTraceback = traceback.replace(filePathRegex, (match, prefix, p1, p2) => {
          const displayPath = filePathPrefix ? p1 : `${prefix}${p1}`;
          return `<a href="${editorPathPrefix}${prefix}${p1}:${p2}" style="color:orange">${displayPath}:${p2}</a>`;
        });
    }
  }

  let formattedOutput = `Error occurred when executing <span style="color:red" class="custom-error">${nodeType} [${nodeId}]</span>:\n\n` +
              `<span style="color:white">${formattedExceptionMessage}</span>`;

  if (formattedTraceback !== exceptionMessage) {
    formattedOutput += `\n\n<span style="color:lightblue">${formattedTraceback}</span>`;
  }

  return formattedOutput;
}


var otherShow = null;
const customShow = function(html) {
  // If this is not an exception let it through as normal.
  if (!html.includes("Error occurred when executing")) {
    return otherShow.apply(this, arguments);
  }

  // Since we know it's an exception now, only let it through
  // if the source is our event listener below, which will have
  // added the special tag to the error while reformatting.
  if (html.includes('class="custom-error"')) {
    return otherShow.apply(this, arguments);
  }
};


api.addEventListener("execution_error", function(e) {
  // Make the dialog upgrade opt-in.
  // If the user hasn't set the editor path prefix or the file path prefix, don't do anything.
  const editorPathPrefix = app.ui.settings.getSettingValue(editorPathPrefixId);
  const filePathPrefix =  app.ui.settings.getSettingValue(sourcePathPrefixId);
  if (!editorPathPrefix && !filePathPrefix) {
    console.log(editorPathPrefix, filePathPrefix);
    return;
  }

  // Replace the default dialog.show with our custom one if we haven't already.
  // We can't do it earlier because other extensions might run later and replace 
  // it out from under us in that case.
  if (!otherShow) {
    otherShow = app.ui.dialog.show;
    app.ui.dialog.show = customShow;
  }
  const formattedError = formatExecutionError.call(app, e.detail);
  app.ui.dialog.show(formattedError);
  app.canvas.draw(true, true);
});


api.addEventListener('logs_updated', ({ detail, }) => {
  let nodesWithLogs = detail.nodes_with_logs;
  console.log("Nodes with logs: ", nodesWithLogs);

  app.graph._nodes.forEach((node) => {
    let strNodeId = "" + node.id;
    node.has_log = nodesWithLogs.includes(strNodeId);
    if (node.has_log) {
      console.log("Node has log: ", strNodeId);
    }
  });
}, false);