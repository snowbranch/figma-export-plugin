figma.showUI(__html__, { width: 400, height: 500 });

interface ImageInfo {
  id: string;
  name: string;
  path: string;
  nodeId: string;
  parentNodeIds: string[];
  parentOriginalNames?: string[];
}

type NamingStrategy = 'suffix' | 'id' | 'merge';

function collectImageNodes(
  node: BaseNode, 
  parentPath: string = "", 
  parentNodeIds: string[] = [], 
  parentOriginalNames: string[] = [],
  includeRoot: boolean = false
): ImageInfo[] {
  const images: ImageInfo[] = [];
  
  // 更新当前路径信息
  const currentPath = (parentPath || includeRoot) ? 
    (parentPath ? `${parentPath}/${sanitizeName(node.name)}` : sanitizeName(node.name)) : 
    "";
  const currentNodeIds = includeRoot || parentNodeIds.length > 0 ? [...parentNodeIds, node.id] : [];
  const currentOriginalNames = includeRoot || parentOriginalNames.length > 0 ? 
    [...parentOriginalNames, node.name] : [];
  
  // 检查是否为有图片填充的节点 - 检查所有可能有fills属性的节点类型
  function hasImageFill(node: BaseNode): boolean {
    // 检查节点是否有fills属性
    if ('fills' in node) {
      const fillNode = node as any;
      if (fillNode.fills && fillNode.fills !== figma.mixed && fillNode.fills.length > 0) {
        // 遍历所有fills，寻找IMAGE类型
        for (const fill of fillNode.fills) {
          if (fill && fill.type === 'IMAGE') {
            return true;
          }
        }
      }
    }
    return false;
  }
  
  // 检查当前节点是否包含图片填充
  if (hasImageFill(node)) {
    console.log(`Found image node: ${node.name} (type: ${node.type})`);
    images.push({
      id: node.id,
      name: node.name,
      path: currentPath,
      nodeId: node.id,
      parentNodeIds: [...currentNodeIds],
      parentOriginalNames: [...currentOriginalNames]
    });
  }
  
  // 递归处理子节点 - 无论当前节点是否为图片节点都要继续遍历
  if ("children" in node) {
    for (const child of node.children) {
      images.push(...collectImageNodes(child, currentPath, currentNodeIds, currentOriginalNames, false));
    }
  }
  
  return images;
}

function sanitizeName(name: string): string {
  return name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').replace(/_/g, '').trim();
}

// 查找多个节点的共同父节点
function findCommonParent(nodes: readonly SceneNode[]): BaseNode | null {
  if (nodes.length === 0) return null;
  if (nodes.length === 1) return nodes[0].parent;
  
  // 获取第一个节点的所有父节点
  const getParents = (node: SceneNode): BaseNode[] => {
    const parents: BaseNode[] = [];
    let current: BaseNode | null = node.parent;
    while (current) {
      parents.push(current);
      current = current.parent;
    }
    return parents;
  };
  
  const firstParents = getParents(nodes[0]);
  
  // 找到所有节点的共同父节点
  for (const parent of firstParents) {
    let isCommon = true;
    for (let i = 1; i < nodes.length; i++) {
      let current: BaseNode | null = nodes[i].parent;
      let found = false;
      while (current) {
        if (current === parent) {
          found = true;
          break;
        }
        current = current.parent;
      }
      if (!found) {
        isCommon = false;
        break;
      }
    }
    if (isCommon) {
      return parent;
    }
  }
  
  return null;
}

// 重命名同一层级的同名节点
function renameDuplicateNodes(rootNode: BaseNode): void {
  console.log('开始重命名同名节点...');
  
  function processNodeChildren(node: BaseNode): void {
    if (!('children' in node)) return;
    
    // 按名称分组同级节点
    const nodesByName = new Map<string, SceneNode[]>();
    
    for (const child of node.children) {
      const name = child.name;
      if (!nodesByName.has(name)) {
        nodesByName.set(name, []);
      }
      nodesByName.get(name)!.push(child);
    }
    
    // 为同名节点添加编号后缀
    for (const [name, nodes] of nodesByName) {
      if (nodes.length > 1) {
        console.log(`发现${nodes.length}个同名节点: ${name}`);
        
        for (let i = 0; i < nodes.length; i++) {
          const newName = i === 0 ? name : `${name}${i}`;
          if (nodes[i].name !== newName) {
            console.log(`重命名节点: ${nodes[i].name} -> ${newName}`);
            nodes[i].name = newName;
          }
        }
      }
    }
    
    // 递归处理子节点
    for (const child of node.children) {
      processNodeChildren(child);
    }
  }
  
  processNodeChildren(rootNode);
  console.log('同名节点重命名完成');
}

// 从父节点收集图片，但只包含选中的节点
function collectImageNodesFromParent(parent: BaseNode, selectedNodes: readonly SceneNode[]): ImageInfo[] {
  const selectedIds = new Set(selectedNodes.map(n => n.id));
  const images: ImageInfo[] = [];
  
  function collectFromNode(node: BaseNode, parentPath: string = "", parentNodeIds: string[] = [], parentOriginalNames: string[] = []): void {
    // 如果当前节点是选中的节点之一，收集其所有子图片
    if (selectedIds.has(node.id)) {
      images.push(...collectImageNodes(node, parentPath, parentNodeIds, parentOriginalNames, true));
      return;
    }
    
    // 否则继续递归查找
    if ("children" in node) {
      const currentPath = parentPath ? `${parentPath}/${sanitizeName(node.name)}` : sanitizeName(node.name);
      const currentNodeIds = [...parentNodeIds, node.id];
      const currentOriginalNames = [...parentOriginalNames, node.name];
      
      for (const child of node.children) {
        collectFromNode(child, currentPath, currentNodeIds, currentOriginalNames);
      }
    }
  }
  
  collectFromNode(parent);
  return images;
}

function processExports(imageNodes: ImageInfo[], strategy: NamingStrategy): { processedPath: string; imageName: string; imageInfo: ImageInfo }[] {
  const result: { processedPath: string; imageName: string; imageInfo: ImageInfo }[] = [];
  
  // 新的统一处理逻辑：构建层级路径并重命名同名节点
  if (strategy === 'suffix') {
    // 为每个图片构建完整的层级路径（从根节点到图片节点）
    const processedImages: { fullPath: string; imageInfo: ImageInfo }[] = [];
    
    for (const imageInfo of imageNodes) {
      // 构建完整路径：父节点路径 + 图片节点名
      const pathParts: string[] = [];
      
      // 添加父节点名称
      if (imageInfo.parentOriginalNames && imageInfo.parentOriginalNames.length > 0) {
        pathParts.push(...imageInfo.parentOriginalNames.map(name => sanitizeName(name)));
      }
      
      // 添加图片节点本身的名称
      pathParts.push(sanitizeName(imageInfo.name));
      
      const fullPath = pathParts.join('_');
      processedImages.push({ fullPath, imageInfo });
    }
    
    // 处理同名路径，添加编号后缀
    const pathCounts = new Map<string, number>();
    
    for (const { fullPath, imageInfo } of processedImages) {
      const count = pathCounts.get(fullPath) || 0;
      pathCounts.set(fullPath, count + 1);
      
      const finalImageName = count > 0 ? `${fullPath}${count}` : fullPath;
      
      result.push({
        processedPath: '', // 所有文件都在根目录
        imageName: finalImageName,
        imageInfo
      });
    }
    
    return result;
  }
  
  if (strategy === 'id') {
    // 使用节点ID策略
    for (const imageInfo of imageNodes) {
      const pathParts: string[] = [];
      
      // 添加父节点ID
      if (imageInfo.parentNodeIds && imageInfo.parentNodeIds.length > 0) {
        pathParts.push(...imageInfo.parentNodeIds);
      }
      
      // 添加图片节点ID
      pathParts.push(imageInfo.nodeId);
      
      const finalImageName = pathParts.join('_');
      
      result.push({ 
        processedPath: '', // 所有文件都在根目录
        imageName: finalImageName, 
        imageInfo 
      });
    }
  } else if (strategy === 'merge') {
    // merge策略 - 使用层级路径但保持文件夹结构
    for (const imageInfo of imageNodes) {
      const pathParts: string[] = [];
      
      // 添加父节点名称
      if (imageInfo.parentOriginalNames && imageInfo.parentOriginalNames.length > 0) {
        pathParts.push(...imageInfo.parentOriginalNames.map(name => sanitizeName(name)));
      }
      
      // 添加图片节点本身的名称
      pathParts.push(sanitizeName(imageInfo.name));
      
      const finalImageName = pathParts.join('_');
      
      result.push({
        processedPath: '', // 所有文件都在根目录
        imageName: finalImageName,
        imageInfo
      });
    }
  }
  
  return result;
}

async function exportImageNode(node: BaseNode, processedPath: string, imageName: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  console.log(`Attempting to export node: ${node.name} (type: ${node.type}, id: ${node.id})`);
  
  if (!("exportAsync" in node)) {
    console.log(`Node ${node.name} does not support exportAsync`);
    return null;
  }
  
  try {
    const exportNode = node as any;
    console.log(`Node dimensions: ${exportNode.width}x${exportNode.height}`);
    
    const bytes = await exportNode.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 2 }
    });
    
    // 所有文件都导出到根目录，使用完整的层级名称
    const fileName = `${imageName}.png`;
    console.log(`Successfully exported: ${fileName}`);
    
    return { name: fileName, bytes };
  } catch (error) {
    console.error(`Error exporting node ${node.name}:`, error);
    return null;
  }
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'export-hierarchy') {
    try {
      const namingStrategy = msg.namingStrategy as NamingStrategy || 'suffix';
      const exportAll = msg.exportAll || false;
      
      // 获取选中节点，即使是exportAll也需要用于重命名逻辑
      const selection = figma.currentPage.selection;
    
      let imageNodes: ImageInfo[] = [];
    
      if (exportAll) {
        // 导出当前页面的所有图片
        imageNodes = collectImageNodes(figma.currentPage);
      } else {
        // 导出选中节点的图片
        if (selection.length === 0) {
          figma.ui.postMessage({
            type: 'error',
            message: '请先选择一个节点，或勾选"导出当前页面的所有图片"'
          });
          return;
        }
        
        // 如果只选择了一个节点，直接处理
        if (selection.length === 1) {
          imageNodes = collectImageNodes(selection[0], "", [], [], true);
        } else {
          // 如果选择了多个节点，找到它们的共同父节点
          const commonParent = findCommonParent(selection);
          if (commonParent) {
            // 从共同父节点开始收集，但只包含选中的节点
            imageNodes = collectImageNodesFromParent(commonParent, selection);
          } else {
            // 如果没有共同父节点，分别处理每个节点
            for (const selectedNode of selection) {
              imageNodes.push(...collectImageNodes(selectedNode));
            }
          }
        }
      }
    
      if (imageNodes.length === 0) {
        figma.ui.postMessage({
          type: 'error',
          message: exportAll ? '当前页面中没有找到图片资源' : '选中的节点中没有找到图片资源'
        });
        return;
      }
    
      // 在导出前重命名同名节点
      if (namingStrategy === 'suffix') {
        if (exportAll) {
          renameDuplicateNodes(figma.currentPage);
        } else {
          // 对选中的节点进行重命名
          if (selection.length === 1) {
            renameDuplicateNodes(selection[0]);
          } else {
            const commonParent = findCommonParent(selection);
            if (commonParent) {
              renameDuplicateNodes(commonParent);
            } else {
              // 如果没有共同父节点，分别处理每个节点
              for (const selectedNode of selection) {
                renameDuplicateNodes(selectedNode);
              }
            }
          }
        }
        
        // 重命名后重新收集图片节点信息
        if (exportAll) {
          imageNodes = collectImageNodes(figma.currentPage);
        } else {
          if (selection.length === 1) {
            imageNodes = collectImageNodes(selection[0], "", [], [], true);
          } else {
            const commonParent = findCommonParent(selection);
            if (commonParent) {
              imageNodes = collectImageNodesFromParent(commonParent, selection);
            } else {
              imageNodes = [];
              for (const selectedNode of selection) {
                imageNodes.push(...collectImageNodes(selectedNode));
              }
            }
          }
        }
      }
    
    // 处理导出路径和名称
    console.log('Processing exports for', imageNodes.length, 'images');
    const processedExports = processExports(imageNodes, namingStrategy);
    console.log('Processed exports:', processedExports.length);
    
    figma.ui.postMessage({
      type: 'export-start',
      total: processedExports.length
    });
    
    const exports: { name: string; bytes: Uint8Array }[] = [];
    let completed = 0;
    
    for (const { processedPath, imageName, imageInfo } of processedExports) {
      console.log(`Exporting ${completed + 1}/${processedExports.length}: ${processedPath}/${imageName}`);
      
      const node = figma.getNodeById(imageInfo.id);
      if (node) {
        const exportData = await exportImageNode(node, processedPath, imageName);
        if (exportData) {
          exports.push(exportData);
        }
      }
      
      completed++;
      figma.ui.postMessage({
        type: 'export-progress',
        completed,
        total: processedExports.length
      });
    }
    
    figma.ui.postMessage({
      type: 'export-complete',
      exports: exports
    });
    } catch (error) {
      console.error('Export error:', error);
      figma.ui.postMessage({
        type: 'error',
        message: `导出失败: ${error.message || '未知错误'}`
      });
    }
  }
  
  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};