const modelLinks = {}
const internalStateKey = Symbol();
let affectedProperties = [];
let needWatchaffectedProperties = false;

function getTypeValue(value, type) {
    switch (type) {
        case 'int': return parseInt(value);
        case 'double': return parseFloat(value);
        case 'string': return value;
        case 'array': return value === '[]' ? [] : null;
        case 'object': return value === '{}' ? {} : null;
    }
}

function checkTypeValue(value, type) {
    switch (type) {
        case 'int': return typeof value === 'number';
        case 'double': return typeof value === 'number';
        case 'string': return typeof value === 'string';
        case 'array': return Array.isArray(value);
        case 'object': return typeof value === 'object';
    }
}

function createPropertyInModel(fullModel, params) {
    const { name, value, type } = params;

    const innerModel = fullModel[internalStateKey];
    innerModel[name] = {
        value: value,
        bindings: [],
        changedHandler: function() {}
    };

    Object.defineProperty(fullModel, name, {
        get() {
            const innerState = fullModel[internalStateKey]
            if (!innerState) return null
            if (!Object.hasOwn(innerState, name)) return null

            if (needWatchaffectedProperties) affectedProperties.push({relatedModel: fullModel, field: name});

            return innerState[name].value
        },
        set(value) {
            if (!checkTypeValue(value, type)) return;

            const innerState = fullModel[internalStateKey]
            if (!innerState) return null
            if (!Object.hasOwn(innerState, name)) return;

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

function registerModels() {
    const models = document.getElementsByTagName('model');
    for (const model of models) {
        const properties = model.querySelectorAll('property');
        const init = model.querySelector('init');
        const initScript = init ? init.innerHTML : '';
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

            createPropertyInModel(modelFullObject, {name, value: propertyValue, type});
        }

        if (initScript) {
            const initFunction = new Function(['model'], initScript);
            initFunction(modelFullObject);
        }

        modelLinks[model] = modelFullObject;
        model.innerHTML = '';
    }
}
function addBindingToProperty(model, property, binding) {
    model[internalStateKey][property].bindings.push(binding);
}

function getModelFromSelectorCache(selector, cacheSelectors) {
    if (selector[0] === '#' && cacheSelectors.has(selector)) {
        return cacheSelectors.get(selector);
    } else {
        const element = document.querySelector(selector);
        if (selector[0] === '#' && element) cacheSelectors.set(selector, element);
        return element;
    }
}
function getModelFromValue(modelValue, cacheSelectors) {
    const parts = modelValue.split(',');
    const result = []
    for (const part of parts) {
        const asIndex = part.indexOf(' as ');
        if (asIndex > -1) { // case <selector> as <modelName>
            const selector = part.substring(0, asIndex);
            const modelName = part.substring(asIndex + 4);
            let element = getModelFromSelectorCache(selector, cacheSelectors);
            if (!element) {
                /* debug warning */ console.warn(`Can't create binding for model by selector ${selector}`);
                continue;
            }

            result.push({ model: modelLinks[element], modelName });
        } else { // case <selector>
            element = getModelFromSelectorCache(part, cacheSelectors);
            if (!element) {
                /* debug warning */ console.warn(`Can't create binding for model by selector ${selector}`);
                continue;
            }

            result.push({ model: modelLinks[element], modelName: 'model' });
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
            addBindingToProperty(affectedPropertyItem.relatedModel, affectedPropertyItem.field, binding);
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
function registerBindings(root, extraModels) {
    const elements = root ? root.querySelectorAll('[h-model]') : document.querySelectorAll('[h-model]');
    const modelSelectorBindings = new Map();
    for (const element of elements) {
        let modelData = getModelFromValue(element.getAttribute('h-model'), modelSelectorBindings);
        if (!modelData.length) continue;

        if (extraModels) modelData = modelData.concat(extraModels);

        const loopAttribute = element.getAttribute('h-loop');
        if (loopAttribute) {
            registerLoop(element, modelData, extraModels);
            continue;
        }

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

function loopPerformer(element, arr, htmlBody, itemName, extraModels) {
    const fragment = document.createDocumentFragment();
    for (const item of arr) {
        const templateElement = document.createElement('template');
        templateElement.innerHTML = htmlBody;
        
        registerBindings(templateElement.content, extraModels.concat([{modelName: itemName, model: item}]));

        fragment.appendChild(templateElement.content);
    }

    element.innerHTML = "";
    element.appendChild(fragment);
}
function registerLoop(loop, modelData, extraModels) {
    if (!modelData.length) return;

    const template = loop.children[0];
    const loopContent = template.innerHTML;
    const fullIndex = loop.getAttribute('h-loop').split(' as ');
    loop.removeAttribute('h-loop');
    const index = fullIndex[0].trim();
    const indexName = fullIndex[1].trim();

    const functionBody = `loopPerformer(loopElement, ${index}, htmlBody, itemName, extraModels)`;
    const loopFunctionParameters = ['loopPerformer', 'htmlBody','loopElement','itemName', 'extraModels'].concat(modelData.map(a => a.modelName));
    const loopFunctionArguments = [loopPerformer, loopContent, loop, indexName, extraModels].concat(modelData.map(a => a.model));

    const loopFunction = new Function(loopFunctionParameters, functionBody);

    const modelParts = index.split('.');
    if (modelParts.length === 2) {
        const relatedModel = modelData.find(a => a.modelName === modelParts[0]).model;
        const relatedProperty = modelParts[1];

        addBindingToProperty(
            relatedModel,
            relatedProperty,
            {
                element: loop,
                args: loopFunctionArguments,
                handler: loopFunction
            }
        );

        loopFunction.apply(window, loopFunctionArguments);
    }
}

function flowHtmlInit() {
    registerModels();
    registerBindings(null, []);
}
flowHtmlInit();

/* export */ function getModelBySelector(selector) {
    const element = document.querySelector(selector);
    if (!element) return;
    return modelLinks[element]
}