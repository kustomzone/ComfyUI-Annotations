import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { createSetting } from "./config_service.js";

const retainPreviewsId = "easy_nodes.RetainPreviews";

app.registerExtension({
    name: "Retain Previews",

    async setup() {
        createSetting(
            retainPreviewsId,
            "🪄 Save preview images across browser sessions. Requires initial refresh to activate/deactivate.",
            "boolean",
            false,
        );
    },

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (!app.ui.settings.getSettingValue(retainPreviewsId)) {
            return;
        }

        const previewTypes = [
            "PreviewImage", "PreviewMask", "PreviewDepth", "PreviewNormal",
             "AnythingCache", "PlotLosses", "SaveAnimatedPNG", "SaveImage"];

        if (previewTypes.includes(nodeData.name)) {
            console.log("Found preview node: " + nodeData.name);

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                onNodeCreated?.apply(this);

                const node = this;
                const widget = {
                    type: "dict",
                    name: "Retain_Previews",
                    options: { serialize: false },
                    _value: {},
                    set value(v) {
                        if (v && v.images && v.images.length > 0) {
                            Promise.all(v.images.map(async (params) => {
                                try {
                                    const response = await api.fetchApi("/easy_nodes/verify_image?" +
                                        new URLSearchParams(params).toString() +
                                        (node.animatedImages ? "" : app.getPreviewFormatParam()) + app.getRandParam());
                                    const data = await response.json();
                                    return data.exists;
                                } catch (error) {
                                    return false;
                                }
                            })).then((results) => {
                                if (results.every(Boolean)) {
                                    this._value = v;
                                    app.nodeOutputs[node.id + ""] = v;
                                } else {
                                    this._value = {};
                                    app.nodeOutputs[node.id + ""] = {};
                                }
                            });
                        } else {
                            this._value = v;
                            app.nodeOutputs[node.id + ""] = v;
                        }
                    },
                    get value() {
                        return this._value;
                    },
                };
                
                this.canvasWidget = this.addCustomWidget(widget);
            }

            const onExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (output) {
                onExecuted?.apply(this, [output]);
                this.canvasWidget.value = output;
            };
        }
    },
});