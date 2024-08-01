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
    this.activeStream = null;
    this.streamPromise = null;
    this.debounceTimeout = null;
    this.isFirstChunk = true;
    this.isClicked = false;
    this.isPinned = false;
    this.pinButton = null;
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
      box-shadow: 0 0 10px rgba(0,0,0,0.5);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      resize: both;
    `;

    this.header = document.createElement('div');
    this.header.style.cssText = `
      padding: 5px 10px;
      background-color: #2a2a2a;
      border-bottom: 1px solid #444;
      font-family: Arial, sans-serif;
      font-size: 14px;
      color: #e0e0e0;
      font-weight: bold;
      cursor: move;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;
    
    const title = document.createElement('span');
    title.textContent = 'Node Log';
    this.header.appendChild(title);

    this.pinButton = document.createElement('button');
    this.pinButton.style.cssText = `
      background: none;
      border: none;
      color: #e0e0e0;
      font-size: 18px;
      cursor: pointer;
      padding: 0 5px;
    `;
    this.pinButton.innerHTML = '📌';
    this.pinButton.title = 'Pin window';
    this.header.appendChild(this.pinButton);

    this.content = document.createElement('div');
    this.content.style.cssText = `
      flex-grow: 1;
      overflow-y: auto;
      margin: 0;
      padding: 10px;
      background-color: #252525;
      color: #e0e0e0;
      font-family: monospace;
      font-size: 12px;
      line-height: 1.4;
      white-space: pre-wrap;
      word-wrap: break-word;
    `;

    this.resizeHandle = document.createElement('div');
    this.resizeHandle.style.cssText = `
      position: absolute;
      right: 0;
      bottom: 0;
      width: 10px;
      height: 10px;
      cursor: nwse-resize;
    `;

    this.window.appendChild(this.header);
    this.window.appendChild(this.content);
    this.window.appendChild(this.resizeHandle);
    document.body.appendChild(this.window);

    this.addEventListeners();
  }

  addEventListeners() {
    let isDragging = false;
    let isResizing = false;
    let startX, startY, startWidth, startHeight;

    const onMouseMove = (e) => {
      if (isDragging) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        this.window.style.left = `${this.window.offsetLeft + dx}px`;
        this.window.style.top = `${this.window.offsetTop + dy}px`;
        startX = e.clientX;
        startY = e.clientY;
      } else if (isResizing) {
        const width = startWidth + (e.clientX - startX);
        const height = startHeight + (e.clientY - startY);
        this.window.style.width = `${Math.max(this.minWidth, width)}px`;
        this.window.style.height = `${Math.max(this.minHeight, height)}px`;
      }
    };

    const onMouseUp = () => {
      isDragging = false;
      isResizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    this.header.addEventListener('mousedown', (e) => {
      if (e.target !== this.pinButton) {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      }
    });

    this.resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = parseInt(document.defaultView.getComputedStyle(this.window).width, 10);
      startHeight = parseInt(document.defaultView.getComputedStyle(this.window).height, 10);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    this.window.addEventListener('mouseenter', () => {
      this.cancelHideTimeout();
    });

    this.window.addEventListener('mouseleave', () => {
      if (!this.isClicked && !this.isPinned) {
        this.scheduleHide();
      }
    });

    // Add click event listener to the window
    this.window.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent the click from propagating to the document
      this.isClicked = true;
      this.cancelHideTimeout();
    });

    // Add global click event listener
    document.addEventListener('click', (e) => {
      if (this.window && this.window.style.display !== 'none' && !this.isPinned) {
        this.isClicked = false;
        this.hide();
      }
    });

    // Add pin button functionality
    this.pinButton.addEventListener('click', () => {
      this.isPinned = !this.isPinned;
      this.pinButton.innerHTML = this.isPinned ? '📍' : '📌';
      this.pinButton.title = this.isPinned ? 'Unpin window' : 'Pin window';
    });
  }
  
  show(x, y, nodeId) {
    if (!this.window) this.create();

    if (!this.isPinned) {
      // Convert canvas coordinates to screen coordinates
      const rect = app.canvas.canvas.getBoundingClientRect();
      const screenX = (x + rect.left + app.canvas.ds.offset[0]) * app.canvas.ds.scale;
      const screenY = (y + rect.top + app.canvas.ds.offset[1]) * app.canvas.ds.scale;
      
      this.window.style.left = `${screenX}px`;
      this.window.style.top = `${screenY}px`;
    }
    
    this.window.style.display = 'flex';
    
    if (this.currentNodeId !== nodeId) {
      this.currentNodeId = nodeId;
      this.content.innerHTML = ''; // Clear previous content
      this.content.scrollTop = 0; // Reset scroll position
      this.debouncedStreamLog();
    }

    this.cancelHideTimeout();
  }

  scheduleHide() {
    if (!this.isPinned) {
      this.cancelHideTimeout();
      this.hideTimeout = setTimeout(() => this.hide(), 300);
    }
  }

  cancelHideTimeout() {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  hide() {
    if (this.window && !this.isClicked && !this.isPinned) {
      this.window.style.display = 'none';
      this.currentNodeId = null;
      this.cancelStream();
    }
  }

  cancelStream() {
    if (this.activeStream) {
      this.activeStream.cancel();
      this.activeStream = null;
    }
    if (this.streamPromise) {
      this.streamPromise.cancel();
      this.streamPromise = null;
    }
  }

  debouncedStreamLog() {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    this.debounceTimeout = setTimeout(() => {
      this.streamLog();
    }, 100); // 100ms debounce
  }

  async streamLog() {
    if (!this.currentNodeId) return;

    // Cancel any existing stream
    this.cancelStream();

    // Create a new AbortController for this stream
    const controller = new AbortController();
    const signal = controller.signal;

    this.streamPromise = (async () => {
      try {
        const response = await api.fetchApi(`/easy_nodes/show_log?node=${this.currentNodeId}`, { signal });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        this.activeStream = reader;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          let text = decoder.decode(value, { stream: true });
          
          // Trim initial whitespace only for the first chunk
          if (this.isFirstChunk) {
            text = text.trimStart();
            this.isFirstChunk = false;
          }
          
          // Render HTML
          this.content.insertAdjacentHTML('beforeend', text);
          
          // Only auto-scroll if the user hasn't scrolled up
          if (this.content.scrollHeight - this.content.scrollTop === this.content.clientHeight) {
            this.content.scrollTop = this.content.scrollHeight;
          }
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Error in streamLog:', error);
        }
      } finally {
        this.activeStream = null;
        this.streamPromise = null;
      }
    })();

    // Attach the cancel method to the promise
    this.streamPromise.cancel = () => {
      controller.abort();
    };
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
  });
}, false);