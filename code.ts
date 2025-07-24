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
  
  // 检查是否为图片节点
  if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE' || node.type === 'POLYGON' || node.type === 'STAR' || node.type === 'VECTOR') {
    const rectNode = node as GeometryMixin;
    if (rectNode.fills && rectNode.fills !== figma.mixed && rectNode.fills.length > 0) {
      const fill = rectNode.fills[0];
      if (fill.type === 'IMAGE') {
        console.log(`Found image node: ${node.name} (type: ${node.type})`);
        images.push({
          id: node.id,
          name: node.name,
          path: parentPath,
          nodeId: node.id,
          parentNodeIds: [...parentNodeIds],
          parentOriginalNames: [...parentOriginalNames]
        });
      }
    }
  }
  
  // 递归处理子节点
  if ("children" in node) {
    const currentPath = (parentPath || includeRoot) ? 
      (parentPath ? `${parentPath}/${sanitizeName(node.name)}` : sanitizeName(node.name)) : 
      "";
    const currentNodeIds = includeRoot || parentNodeIds.length > 0 ? [...parentNodeIds, node.id] : [];
    const currentOriginalNames = includeRoot || parentOriginalNames.length > 0 ? 
      [...parentOriginalNames, node.name] : [];
    
    for (const child of node.children) {
      images.push(...collectImageNodes(child, currentPath, currentNodeIds, currentOriginalNames, false));
    }
  }
  
  return images;
}

function sanitizeName(name: string): string {
  return name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').trim();
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
  
  if (strategy === 'id') {
    // 使用节点ID策略
    for (const imageInfo of imageNodes) {
      const pathParts = imageInfo.parentNodeIds.map(id => id);
      const processedPath = pathParts.join('/');
      const imageName = imageInfo.nodeId;
      result.push({ processedPath, imageName, imageInfo });
    }
  } else if (strategy === 'suffix') {
    // 自动添加后缀策略 - 基于节点ID结构，然后重命名
    console.log('Starting suffix strategy processing');
    console.log('Image nodes:', imageNodes.map(n => ({ 
      name: n.name, 
      path: n.path,
      parentOriginalNames: n.parentOriginalNames 
    })));
    
    // 第一步：基于节点结构建立完整的树
    interface TreeNode {
      id: string;
      originalName: string;
      children: Map<string, TreeNode>;
      images: ImageInfo[];
    }
    
    const root: TreeNode = {
      id: 'root',
      originalName: '',
      children: new Map(),
      images: []
    };
    
    // 构建树结构
    for (const imageInfo of imageNodes) {
      let currentNode = root;
      
      // 遍历父节点路径
      for (let i = 0; i < imageInfo.parentNodeIds.length; i++) {
        const nodeId = imageInfo.parentNodeIds[i];
        const originalName = imageInfo.parentOriginalNames?.[i] || nodeId;
        
        if (!currentNode.children.has(nodeId)) {
          currentNode.children.set(nodeId, {
            id: nodeId,
            originalName: originalName,
            children: new Map(),
            images: []
          });
        }
        currentNode = currentNode.children.get(nodeId)!;
      }
      
      // 将图片添加到最终节点
      currentNode.images.push(imageInfo);
    }
    
    // 第二步：遍历树并重命名
    function processTree(node: TreeNode, parentPath: string = ''): void {
      // 处理当前节点的所有子节点
      const childrenByName = new Map<string, TreeNode[]>();
      
      // 按原始名称分组
      for (const [id, child] of node.children) {
        const name = sanitizeName(child.originalName);
        if (!childrenByName.has(name)) {
          childrenByName.set(name, []);
        }
        childrenByName.get(name)!.push(child);
      }
      
      // 为同名节点添加后缀
      for (const [name, nodes] of childrenByName) {
        if (nodes.length === 1) {
          // 只有一个，不需要后缀
          const child = nodes[0];
          const childPath = parentPath ? `${parentPath}/${name}` : name;
          
          // 处理该节点下的图片
          for (const img of child.images) {
            const imageName = sanitizeName(img.name);
            result.push({ 
              processedPath: childPath, 
              imageName, 
              imageInfo: img 
            });
          }
          
          // 递归处理子节点
          processTree(child, childPath);
        } else {
          // 有多个同名节点，需要添加后缀
          for (let i = 0; i < nodes.length; i++) {
            const child = nodes[i];
            const suffixedName = i === 0 ? name : `${name}_${i}`;
            const childPath = parentPath ? `${parentPath}/${suffixedName}` : suffixedName;
            
            // 处理该节点下的图片
            for (const img of child.images) {
              const imageName = sanitizeName(img.name);
              result.push({ 
                processedPath: childPath, 
                imageName, 
                imageInfo: img 
              });
            }
            
            // 递归处理子节点
            processTree(child, childPath);
          }
        }
      }
      
      // 处理直接在当前节点下的图片（没有子文件夹）
      const imagesByName = new Map<string, ImageInfo[]>();
      for (const img of node.images) {
        const name = sanitizeName(img.name);
        if (!imagesByName.has(name)) {
          imagesByName.set(name, []);
        }
        imagesByName.get(name)!.push(img);
      }
      
      for (const [name, images] of imagesByName) {
        if (images.length === 1) {
          result.push({ 
            processedPath: parentPath, 
            imageName: name, 
            imageInfo: images[0] 
          });
        } else {
          for (let i = 0; i < images.length; i++) {
            const suffixedName = i === 0 ? name : `${name}_${i}`;
            result.push({ 
              processedPath: parentPath, 
              imageName: suffixedName, 
              imageInfo: images[i] 
            });
          }
        }
      }
    }
    
    processTree(root);
    
    // 输出处理结果
    for (const item of result) {
      console.log(`Processed: ${item.processedPath}/${item.imageName}`);
    }
    
  } else {
    // merge策略 - 合并同名文件夹
    const nameCounts = new Map<string, number>();
    
    for (const imageInfo of imageNodes) {
      const processedPath = imageInfo.path;
      
      // 只处理同名图片文件
      const nameKey = `${processedPath}/${imageInfo.name}`;
      const nameCount = nameCounts.get(nameKey) || 0;
      const imageName = nameCount > 0 ? `${sanitizeName(imageInfo.name)}_${nameCount}` : sanitizeName(imageInfo.name);
      nameCounts.set(nameKey, nameCount + 1);
      
      result.push({ processedPath, imageName, imageInfo });
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
    
    const fileName = processedPath ? `${processedPath}/${imageName}.png` : `${imageName}.png`;
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
    
    let imageNodes: ImageInfo[] = [];
    
    if (exportAll) {
      // 导出当前页面的所有图片
      imageNodes = collectImageNodes(figma.currentPage);
    } else {
      // 导出选中节点的图片
      const selection = figma.currentPage.selection;
      
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