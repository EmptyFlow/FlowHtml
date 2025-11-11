const modelLinks = {}
const internalStateKey = Symbol();
let affectedProperties = [];
let needWatchaffectedProperties = false;

function getTypeValue(value, type) {
    switch (type) {
        case 'int': return parseInt(value)
        case 'double': return parseFloat(value)
        case 'string': return value
        case 'array': return JSON.parse(value)
        case 'object': return JSON.parse(value)
    }
}

function registerModels() {
    const models = document.getElementsByTagName('model');
    for (const model of models) {
        const properties = model.querySelectorAll('property');
        const internalObject = {}
        const modelFullObject = {}
        modelFullObject[internalStateKey] = internalObject
        for (const property of properties) {
            const name = property.getAttribute('name')
            const type = property.getAttribute('type')
            if (!name || !type) continue;

            const defaultValue = property.getAttribute('default')
            let propertyValue = null;
            if (type === 'event-handler') {
                const handlerParameters = [`data`]
                propertyValue = new Function(...handlerParameters, property.innerHTML);
            } else {
                propertyValue = defaultValue ? getTypeValue(defaultValue, type) : null;
            }

            internalObject[name] = {
                value: propertyValue,
                bindings: [],
                changedHandler: function() {}
            };

            Object.defineProperty(modelFullObject, name, {
                get() {
                    const innerState = modelFullObject[internalStateKey]
                    if (!innerState) return null
                    if (!Object.hasOwn(innerState, name)) return null

                    if (needWatchaffectedProperties) affectedProperties.push({relatedModel: modelFullObject, field: name});

                    return innerState[name].value
                },
                set(value) {
                    const innerState = modelFullObject[internalStateKey]
                    if (!innerState) return null
                    if (!Object.hasOwn(innerState, name)) return null

                    const relatedState = innerState[name];
                    relatedState.value = value;
                    const needDeleteBindings = []
                    for (const binding of relatedState.bindings) {
                        if (binding.element) {
                            binding.handler.apply(window, binding.args)
                        } else {
                            needDeleteBindings.push(binding);
                        }
                    }
                    if (needDeleteBindings.length) relatedState.bindings = relatedState.bindings.filter(a => !needDeleteBindings.find( b => b === a))
                    relatedState.changedHandler();
                },
                configurable: false,
                enumerable: true
            })
        }

        modelLinks[model] = modelFullObject;
        model.innerHTML = '';
    }
}

function getModelFromValue(modelValue, cacheSelectors) {
    const parts = modelValue.split(',');
    const result = []
    for (const part of parts) {
        const asIndex = part.indexOf(' as ');
        if (asIndex > -1) {
            const selector = part.substring(0, asIndex);
            const modelName = part.substring(asIndex + 4);
            let element = null;
            if (selector[0] === '#' && cacheSelectors.has(selector)) {
                element = cacheSelectors.get(selector);
            } else {
                element = document.querySelector(selector);
                if (selector[0] === '#') cacheSelectors.set(selector, element);
            }
            if (!element) continue;

            result.push({ model: modelLinks[element], modelName });
        }
    }

    return result
}
function watchAffectedProperties(callback) {
    needWatchaffectedProperties = true;
    affectedProperties = [];

    callback();

    needWatchaffectedProperties = false;
}
function createBindingForAttribute(element, attribute, models, contentCallback, contentRequired) {
    const content = element.getAttribute(attribute);
    if (contentRequired && !content) return;

    const functionItems = models.map(a => a.modelName);
    functionItems.unshift('element');
    
    const functionArguments = models.map(a => a.model)
    functionArguments.unshift(element)
    const bindingHandler = new Function(...functionItems, contentCallback(content, element, attribute));
    watchAffectedProperties(() => {
        bindingHandler.apply(window, functionArguments)
    });
    if (affectedProperties.length) {
        for (const affectedPropertyItem of affectedProperties) {
            const binding = {
                element: element,
                args: functionArguments,
                handler: bindingHandler
            }
            affectedPropertyItem.relatedModel[internalStateKey][affectedPropertyItem.field].bindings.push(binding);
        }
    }

    element.removeAttribute(attribute);
}
function createBindingForEvent(element, attribute, models) {
    const clickHandler = element.getAttribute(attribute);
    const nameOfEvent = attribute.replace('e-', '');
    if (clickHandler) {
        const functionItems = ['event', 'element']
        for (const model of models) functionItems.push(model.modelName);

        const innerArguments = models.map(a => a.model);
        innerArguments.unshift(element);
        const bindingHandler = new Function(...functionItems, clickHandler);
        element.addEventListener(nameOfEvent, (event) => {
            bindingHandler.apply(window, [event].concat(innerArguments))
        });
    }

    element.removeAttribute(attribute);
}
function attributeContentBinding(content, element, attribute) {
    return `element.setAttribute('${attribute.substring(2)}', ${content})`;
}
function contentBinding(content, element) {
    if (content) return `element.innerHTML = ${content}`;

    let innerContent = element.innerHTML.replace(/{{(.*?)}}/g, "' + $1 + '");
    if (innerContent.length > 1) {
        if (innerContent[innerContent.length - 1] !== "'") innerContent += "'";
        if (innerContent[0] !== "'") innerContent = "'" + innerContent;
    } else {
        innerContent = "''";
    }

    return "element.innerHTML = " + innerContent;
}
function registerBindings() {
    const elements = document.querySelectorAll('[h-model]');
    const modelSelectorBindings = new Map();
    for (const element of elements) {
        const modelData = getModelFromValue(element.getAttribute('h-model'), modelSelectorBindings);
        if (!modelData.length) continue;

        const attributes = element.getAttributeNames()
        for (const attribute of attributes) {
            if (attribute === `h-model`) continue;

            // events
            if (attribute.startsWith('e-')) {
                createBindingForEvent(element, attribute, modelData);
                continue;
            }

            // attributes or content
            if (attribute.startsWith('h-')) {
                const isContent = attribute === 'h-content';
                createBindingForAttribute(element, attribute, modelData, isContent ? contentBinding : attributeContentBinding, isContent ? false : true);
            }
        }
        
        element.removeAttribute('h-model');
    }
}

function flowHtmlInit() {
    registerModels();
    registerBindings();
}
flowHtmlInit();

function getModelBySelector(selector) {
    const element = document.querySelector(selector);
    if (!element) return;
    return modelLinks[element]
}