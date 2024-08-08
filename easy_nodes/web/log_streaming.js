import { api } from '../../scripts/api.js';
import { app } from "../../../scripts/app.js";


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
  
  resetStream() {
      this.content.innerHTML = ''; // Clear previous content
      this.content.scrollTop = 0; // Reset scroll position
      this.streamLog();
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
    }, 100);
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


export const floatingLogWindow = new FloatingLogWindow();


api.addEventListener('logs_updated', ({ detail, }) => {
  let nodesWithLogs = detail.nodes_with_logs;
  let prompt_id = detail.prompt_id;

  console.log("Nodes with logs: ", nodesWithLogs);

  app.graph._nodes.forEach((node) => {
    let strNodeId = "" + node.id;
    node.has_log = nodesWithLogs.includes(strNodeId);
  });

  // If the floating log window is showing logs for a node that has a new log, refresh it:
  if (floatingLogWindow.currentPromptId != prompt_id && nodesWithLogs.includes(floatingLogWindow.currentNodeId + "")) {
    floatingLogWindow.resetStream();
  }
  floatingLogWindow.currentPromptId = prompt_id;
  app.canvas.setDirty(true);
}, false);

app.registerExtension({
    name: "EasyNodes.log_streaming",
    async setup(app) {
        console.log("Setting up log streaming extension");
    },
    async afterConfigureGraph(missingNodeTypes) {
        app.graph._nodes.forEach((node) => {
          node.has_log = false;
        });
        api.fetchApi('/easy_nodes/trigger_log', { method: 'POST' });
    },
});

api.addEventListener("status", ({ detail }) => {
  if (!detail) {
    app.graph._nodes.forEach((node) => {
      node.has_log = false;
    });
    app.canvas.setDirty(true);
  }
});

api.addEventListener("reconnected", () => {
  api.fetchApi('/easy_nodes/trigger_log', { method: 'POST' });
});
