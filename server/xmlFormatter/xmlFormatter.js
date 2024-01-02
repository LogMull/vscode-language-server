// Directly taken from xml-js by nashwaan and modified to allow custom handling for tags and attribute ordering
// https://github.com/nashwaan/xml-js/blob/f0376f265c4f299100fb4766828ebf066a0edeec/lib/js2xml.js
var helper = require('./options-helper');
const oscConfig = require('./xmlConfig.json');

var currentElement, currentElementName,currentElementNameClean;


// Write attributes, much of the customization comes from this method
function writeAttributes(attributes, options, depth) {
    var key, attr, attrName, quote, result = [];
    let sortedAttr =[];
    let extraAttr=[];
    // First, build the sorted array
    // Start with the generic order that applies to all
    for (let attr of oscConfig.defaultAttrOrder){
        sortedAttr.push(attr); 
    }
    // Get all of the attribute options based on the current tag name
    sortedAttr = getAttrOrderbyTag(currentElementNameClean,sortedAttr);
    // Add in the trailing default order.
    for (let attr of oscConfig.defaultAttrTrailing){
        if (sortedAttr.indexOf(attr)<0){
            sortedAttr.push(attr)
        }
    }
    // filter down to a list of attributes the current node actually has.
    sortedAttr=sortedAttr.filter((attr) => (attributes.hasOwnProperty(attr) && attributes[attr] !== null && attributes[attr] !== undefined ));
    // Force the remaining attributes to be put into the extraAttr array so that they can be alphabetically sorted
    for (key in attributes) {
        if (attributes.hasOwnProperty(key) && attributes[key] !== null && attributes[key] !== undefined && sortedAttr.indexOf(key)<0) {
            extraAttr.push(key);
        }
    }
    // Alphabetically sort the extra attributes
    allAttr = sortedAttr.concat(extraAttr.sort())
    quote = '"';
    // Now determine how long the entire string of attributes will be
    let len = 0;
    for (let key in allAttr){
        attrName = allAttr[key]
        attr = '' + attributes[attrName];
        len += attrName.length+attr.length+3;
    }
    // Add the attributes back in order
    for (let key in allAttr){
        attrName = allAttr[key]
        attr = '' + attributes[attrName]; // ensure number and boolean are converted to String
        attr = attr.replace(/"/g, '&quot;');
        //If the tag name is specified in forceSingleLine, then it may never be split up, so just insert a space
        if (oscConfig.forceSingleLine.includes(currentElementNameClean)) {
            result.push(' ');
        } else if (Object.keys(attributes).length < oscConfig.minAttrForMultiLine){ // Check if the number of attributes is below our multi line threshold
            result.push(' ');
        }else if( len <= oscConfig.minAttrLengthForMultiLine){ // Check if the total attr string length is less than the treshold for multiple lines
            result.push(' ');
        }
        else{
            // Check if there is a regex option that matches this tag, primarily used for gridColumns or parameters
            let opts = getOptsbyRegex(currentElementNameClean);
            if (opts && opts.forceSingleLine){
                result.push(' ');
            }else{
                result.push(writeIndentation(options, depth + 1, false) ); 
            }
        }
        // Push the actual attribute value
        result.push(attrName + '=' + quote + attr + quote);
    }
    
    if (attributes && Object.keys(attributes).length && options.spaces) {
        // result.push(writeIndentation(options, depth, false));
        // LCM if we want the ending tag to be on the same line, leave this out.  If we want it on a new line, uncomment the above line
    }
    return result.join('');
}
// Return the specific options for a regex option override if the tag name matches any options.
function getOptsbyRegex(tagName){
    let regexes = oscConfig.tagOptionsByRegex;
    for (let regex in regexes){
        if (tagName.match(regex)){
            return regexes[regex];
        }
    }
    // If none is found, return false
    return false;
}

/// Helper to get a list of attributes in the proper order for a tag name.
/// This is recursively called
/// Anything already present in order should be considered accurate and preserved.
/// General path is to get all (unique) attr from the tag indicated in includeTagsBefore and concat them into order.  If order already contains an attr in includeTagsBefore, it will not be added a second time
// If the curernt tag includes an attr and so does includeTagsBefore, it will be added with the current tag's ordering.

// Order of precdence (spelling?):
// Order - always preserved
// myOrder
// includeTagsBefore
// includeTagsAfter
function getAttrOrderbyTag(tag,order){

    let tagInfo = oscConfig.tagOptions[tag];
     // If the specified tag does not have an explicit option listed, check regexes then use the default
    if (!tagInfo){
        tagInfo = getOptsbyRegex(tag);
        if (!tagInfo){
            tagInfo = oscConfig.tagOptions['<default>'];
        }
    }
    // some elements may just be copies of others, for example expression and explorer lists are very closely related
    if (tagInfo.copyOf){
        tagInfo=oscConfig.tagOptions[tagInfo.copyOf];
    }
   
    let myOrder = tagInfo.attrOrder;
    let prevOrder = [];
    let trailingOrder = [];
    // Get any attr that should be included by a 'parent' type
    if (tagInfo.includeTagsBefore){
        prevOrder = getAttrOrderbyTag(tagInfo.includeTagsBefore,order); // LCM
    }
    if (tagInfo.includeTagsAfter){
        trailingOrder = getAttrOrderbyTag(tagInfo.includeTagsAfter,order)
    }
    
    // Filter anything out of myOrder that is already in order
    myOrder = myOrder.filter((attr) => order.indexOf(attr)<0);
    prevOrder = prevOrder.filter((attr) => (order.indexOf(attr)<0 && myOrder.indexOf(attr)<0) );
    trailingOrder = trailingOrder.filter((attr) => (order.indexOf(attr)<0 && myOrder.indexOf(attr)<0) && prevOrder.indexOf(attr)<0 );
    
    newOrder = order.concat(prevOrder,myOrder,trailingOrder);
    return newOrder
}

// -------------------------------------------------------------------
// As of the original writing, everything below this point is either original to the library or only slightly modified.
function validateOptions(userOptions) {
    var options = helper.copyOptions(userOptions);
    helper.ensureFlagExists('ignoreDeclaration', options);
    helper.ensureFlagExists('ignoreInstruction', options);
    helper.ensureFlagExists('ignoreAttributes', options);
    helper.ensureFlagExists('ignoreText', options);
    helper.ensureFlagExists('ignoreComment', options);
    helper.ensureFlagExists('ignoreCdata', options);
    helper.ensureFlagExists('ignoreDoctype', options);
    helper.ensureFlagExists('compact', options);
    helper.ensureFlagExists('indentText', options);
    helper.ensureFlagExists('indentCdata', options);
    helper.ensureFlagExists('indentAttributes', options);
    helper.ensureFlagExists('indentInstruction', options);
    helper.ensureFlagExists('fullTagEmptyElement', options);
    helper.ensureFlagExists('noQuotesForNativeAttributes', options);
    helper.ensureSpacesExists(options);
    if (typeof options.spaces === 'number') {
        options.spaces = Array(options.spaces + 1).join(' ');
    }
    helper.ensureKeyExists('declaration', options);
    helper.ensureKeyExists('instruction', options);
    helper.ensureKeyExists('attributes', options);
    helper.ensureKeyExists('text', options);
    helper.ensureKeyExists('comment', options);
    helper.ensureKeyExists('cdata', options);
    helper.ensureKeyExists('doctype', options);
    helper.ensureKeyExists('type', options);
    helper.ensureKeyExists('name', options);
    helper.ensureKeyExists('elements', options);
    helper.checkFnExists('doctype', options);
    helper.checkFnExists('instruction', options);
    helper.checkFnExists('cdata', options);
    helper.checkFnExists('comment', options);
    helper.checkFnExists('text', options);
    helper.checkFnExists('instructionName', options);
    helper.checkFnExists('elementName', options);
    helper.checkFnExists('attributeName', options);
    helper.checkFnExists('attributeValue', options);
    helper.checkFnExists('attributes', options);
    helper.checkFnExists('fullTagEmptyElement', options);
    return options;
}


function writeIndentation(options, depth, firstLine) {
    return (!firstLine && options.spaces ? '\n' : '') + Array(depth + 1).join(options.spaces);
}
function writeDeclaration(declaration, options, depth) {
    currentElement = declaration;
    currentElementName = 'xml';
    currentElementNameClean = currentElementName;
    return options.ignoreDeclaration ? '' : '<?' + 'xml' + writeAttributes(declaration[options.attributesKey], options, depth) + '?>';
}

function writeInstruction(instruction, options, depth) {
    if (options.ignoreInstruction) {
        return '';
    }
    var key;
    for (key in instruction) {
        if (instruction.hasOwnProperty(key)) {
            break;
        }
    }
    var instructionName = 'instructionNameFn' in options ? options.instructionNameFn(key, instruction[key], currentElementName, currentElement) : key;
    if (typeof instruction[key] === 'object') {
        currentElement = instruction;
        currentElementName = instructionName;
        currentElementNameClean = currentElementName
        return '<?' + instructionName + writeAttributes(instruction[key][options.attributesKey], options, depth) + '?>';
    } else {
        var instructionValue = instruction[key] ? instruction[key] : '';
        if ('instructionFn' in options) instructionValue = options.instructionFn(instructionValue, key, currentElementName, currentElement);
        return '<?' + instructionName + (instructionValue ? ' ' + instructionValue : '') + '?>';
    }
}

function writeComment(comment, options) {
    return options.ignoreComment ? '' : '<!--' + ('commentFn' in options ? options.commentFn(comment, currentElementName, currentElement) : comment) + '-->';
}

function writeCdata(cdata, options) {
    return options.ignoreCdata ? '' : '<![CDATA[' + ('cdataFn' in options ? options.cdataFn(cdata, currentElementName, currentElement) : cdata.replace(']]>', ']]]]><![CDATA[>')) + ']]>';
}

function writeDoctype(doctype, options) {
    return options.ignoreDoctype ? '' : '<!DOCTYPE ' + ('doctypeFn' in options ? options.doctypeFn(doctype, currentElementName, currentElement) : doctype) + '>';
}

function writeText(text, options) {
    if (options.ignoreText) return '';
    text = '' + text; // ensure Number and Boolean are converted to String
    return 'textFn' in options ? options.textFn(text, currentElementName, currentElement) : text;
}

function hasContent(element, options) {
    var i;
    if (element.elements && element.elements.length) {
        for (i = 0; i < element.elements.length; ++i) {
            switch (element.elements[i][options.typeKey]) {
                case 'text':
                    if (options.indentText) {
                        return true;
                    }
                    break; // skip to next key
                case 'cdata':
                    if (options.indentCdata) {
                        return true;
                    }
                    break; // skip to next key
                case 'instruction':
                    if (options.indentInstruction) {
                        return true;
                    }
                    break; // skip to next key
                case 'doctype':
                case 'comment':
                case 'element':
                    return true;
                default:
                    return true;
            }
        }
    }
    return false;
}

function writeElement(element, options, depth) {
    currentElement = element;
    currentElementName = element.name;
    if (currentElementName.includes(':')){
        currentElementNameClean = currentElementName.split(':')[1];
    }else{
        currentElementNameClean = currentElementName;
    }
    var xml = [], elementName = 'elementNameFn' in options ? options.elementNameFn(element.name, element) : element.name;
    xml.push('<' + elementName);
    if (element[options.attributesKey]) {
        xml.push(writeAttributes(element[options.attributesKey], options, depth));
    }
    var withClosingTag = element[options.elementsKey] && element[options.elementsKey].length || element[options.attributesKey] && element[options.attributesKey]['xml:space'] === 'preserve';
    if (!withClosingTag) {
        if ('fullTagEmptyElementFn' in options) {
            withClosingTag = options.fullTagEmptyElementFn(element.name, element);
        } else {
            withClosingTag = options.fullTagEmptyElement;
        }
    }
    if (withClosingTag) {
        xml.push('>');
        if (element[options.elementsKey] && element[options.elementsKey].length) {
            xml.push(writeElements(element[options.elementsKey], options, depth + 1));
            currentElement = element;
            currentElementName = element.name;
            if (currentElementName.includes(':')) {
                currentElementNameClean = currentElementName.split(':')[1];
            } else {
                currentElementNameClean = currentElementName;
            }
        }
        xml.push(options.spaces && hasContent(element, options) ? '\n' + Array(depth + 1).join(options.spaces) : '');
        xml.push('</' + elementName + '>');
    } else {
        xml.push('/>');
    }
    return xml.join('');
}

function writeElements(elements, options, depth, firstLine) {
    return elements.reduce(function (xml, element) {
        var indent = writeIndentation(options, depth, firstLine && !xml);
        switch (element.type) {
            case 'element': return xml + indent + writeElement(element, options, depth);
            case 'comment': return xml + indent + writeComment(element[options.commentKey], options);
            case 'doctype': return xml + indent + writeDoctype(element[options.doctypeKey], options);
            case 'cdata': return xml + (options.indentCdata ? indent : '') + writeCdata(element[options.cdataKey], options);
            case 'text': return xml + (options.indentText ? indent : '') + writeText(element[options.textKey], options);
            case 'instruction':
                var instruction = {};
                instruction[element[options.nameKey]] = element[options.attributesKey] ? element : element[options.instructionKey];
                return xml + (options.indentInstruction ? indent : '') + writeInstruction(instruction, options, depth);
        }
    }, '');
}


module.exports = function (js, options) {
    options = validateOptions(options);
    var xml = [];
    currentElement = js;
    currentElementName = '_root_';
   
    if (js[options.declarationKey]) {
        xml.push(writeDeclaration(js[options.declarationKey], options, 0));
    }
    if (js[options.elementsKey] && js[options.elementsKey].length) {
        xml.push(writeElements(js[options.elementsKey], options, 0, !xml.length));
    }
    
    return xml.join('');
};
