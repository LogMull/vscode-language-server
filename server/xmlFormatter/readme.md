This document will outline how to use the config files.  Note that this is a configuration for how the extension handles formatting the XML internally.
This is NOT intended to be set by users but rather to make changing / extending the behavior easier to configure an not a horrible mess of hard coded junk

Note that XML namespaces (osc: artiva:, etc) should be omitted from all tag names

forceSingleLine - Array of tag names which should always be forced to be a single line instead of splitting the attributes
minAttrForMultiLine - Min number of attributes before a tag will wrap its attributes for new lines.  If a tag has fewer than this, it will be a single line
minAttrLengthForMultiLine - Min length of characters of attributes before a tag will wrap its attributes for new lines.  If a tag has fewer than this, it will be a single line
defaultAttrOrder - Array of attribute names in the order they should be shown.  This is applied FIRST for ALL tag types
defaultAttrTrailing - Array of attribute names in the order they should be shown.  This is applied LAST for ALL tag types.  If any of these tags have already been included, they will not be duplicated
tagOptions - Array of options for a specific tag
    If no specific override is found, <default> will be used
    The primary function of these overrides is to provide an 'attrOrder' property which is an array of attribute names in the order they should be presented.
    If copyOf is specified, then all properties from the listed tag name will be used for the current tag.  For example, numeric simply copied what integer specifies
    Additionally, overrides can specify includeTagsBefore and includeTagsAfter properties to include all of the attributes in the listed tag eithr before or after their own attrOrder
        If this is used and there are any duplicated attributes, the attrOrder will take priority 

No attributes should ever be duplicated in the resulting XML regardless of how the configuration may be set up.
Any attributes not listed specificially be the configuration will be thrown onto the end of an element in alphabetical order 
